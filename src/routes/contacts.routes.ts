import express from 'express';
import { flattenError } from 'zod';
import { prisma } from '@lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { groupBySection } from '../utils/hangul.js';
import { CreateGroupBody, PatchGroupBody, GroupIdParam } from '../types/contacts.js';
import type { ContactListItem, ContactSection } from '../types/contacts.js';

const router = express.Router();

// 연락처 + 그룹을 합쳐 가나다(초성) 섹션으로 반환
// [ { key: "ㄱ", items: [{type:'contact'|'group', ...}] }, ... ]
router.get('', requireAuth, async (req, res) => {
  const ownerUserId = req.auth!.userId;

  const [contacts, groups] = await Promise.all([
    prisma.contact.findMany({
      where: { ownerUserId },
      select: { id: true, name: true, image: true, provider: true },
    }),
    prisma.contactGroup.findMany({
      where: { ownerUserId },
      select: {
        id: true,
        name: true,
        image: true,
        _count: { select: { members: true } },
      },
    }),
  ]);

  const items: ContactListItem[] = [
    ...contacts.map((c) => ({
      type: 'contact' as const,
      id: c.id,
      name: c.name,
      image: c.image,
      social: c.provider,
    })),
    ...groups.map((g) => ({
      type: 'group' as const,
      id: g.id,
      name: g.name,
      image: g.image,
      membersCount: g._count.members,
    })),
  ];

  const sections: ContactSection[] = groupBySection(items);
  res.json(sections);
});

router.get('/group/:id', requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const groupId = req.params.id;

  if (typeof groupId !== 'string') {
    return res.status(400).json({ error: 'Invalid group id' });
  }

  const group = await prisma.contactGroup.findFirst({
    where: { id: groupId, ownerUserId: userId },
    select: {
      id: true,
      name: true,
      image: true,
      members: {
        orderBy: { contact: { name: 'asc' } },
        select: {
          contact: { select: { id: true, name: true, image: true, provider: true } },
        },
      },
    },
  });

  if (!group) return res.status(404).json({ message: 'not found' });

  return res.json({
    id: group.id,
    name: group.name,
    image: group.image,
    members: group.members.map((m) => {
      return { type: 'contact', ...m.contact };
    }),
  });
});

router.patch('/group/:id', requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const groupId = req.params.id;
  if (typeof groupId !== 'string') {
    return res.status(400).json({ code: 'INVALID_GROUP_ID' });
  }

  const parsed = PatchGroupBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: 'INVALID_BODY', errors: flattenError(parsed.error) });
  }
  const { name, image, membersId } = parsed.data;

  const group = await prisma.contactGroup.findFirst({
    where: { id: groupId, ownerUserId: userId },
    select: { id: true },
  });
  if (!group) return res.status(404).json({ code: 'GROUP_NOT_FOUND' });

  // 멤버 변경이 있으면 미리 소유권 검증 + diff 계산
  let memberDiff: { toAdd: string[]; toRemove: string[] } | null = null;
  if (membersId) {
    const ids = [...new Set(membersId)];
    const owned = await prisma.contact.count({ where: { id: { in: ids }, ownerUserId: userId } });
    if (owned !== ids.length) return res.status(400).json({ code: 'INVALID_CONTACTS' });

    const current = await prisma.contactGroupMember.findMany({
      where: { contactGroupId: groupId },
      select: { contactId: true },
    });
    const currentSet = new Set(current.map((m) => m.contactId));
    const nextSet = new Set(ids);
    memberDiff = {
      toAdd: ids.filter((id) => !currentSet.has(id)),
      toRemove: [...currentSet].filter((id) => !nextSet.has(id)),
    };
  }

  // 이름/이미지 수정 + 멤버 diff 를 하나의 트랜잭션으로
  await prisma.$transaction(async (tx) => {
    if (name !== undefined || image !== undefined) {
      await tx.contactGroup.update({
        where: { id: groupId },
        data: {
          ...(name !== undefined && { name }),
          ...(image !== undefined && { image }),
        },
      });
    }

    if (memberDiff) {
      if (memberDiff.toAdd.length) {
        await tx.contactGroupMember.createMany({
          data: memberDiff.toAdd.map((contactId) => ({ contactGroupId: groupId, contactId })),
          skipDuplicates: true,
        });
      }
      if (memberDiff.toRemove.length) {
        await tx.contactGroupMember.deleteMany({
          where: { contactGroupId: groupId, contactId: { in: memberDiff.toRemove } },
        });
      }
    }
  });

  return res.sendStatus(204);
});

router.delete('/group/:id', requireAuth, async (req, res) => {
  const { userId } = req.auth!;

  const parsed = GroupIdParam.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ code: 'INVALID_GROUP_ID' });
  }
  const { id: groupId } = parsed.data;

  // 소유한 그룹만 삭제. 멤버(ContactGroupMember)는 FK onDelete: Cascade 로 함께 삭제된다.
  // deleteMany + ownerUserId 조건으로 "소유권 검증 + 삭제"를 한 번의 원자적 쿼리로 처리.
  // (findFirst 후 delete 로 나누면 TOCTOU 여지가 있고 쿼리도 2번 나간다.)
  const { count } = await prisma.contactGroup.deleteMany({
    where: { id: groupId, ownerUserId: userId },
  });

  // count 0 = 존재하지 않거나 남의 그룹. 둘을 구분하지 않아야 IDOR 정보 노출이 없다.
  if (count === 0) return res.status(404).json({ code: 'GROUP_NOT_FOUND' });

  return res.sendStatus(204);
});

router.post('/group', requireAuth, async (req, res) => {
  const { userId } = req.auth!;

  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: 'INVALID_BODY', errors: flattenError(parsed.error) });
  }
  const { name, image, membersId } = parsed.data;

  const ids = [...new Set(membersId)];

  const owned = await prisma.contact.count({ where: { id: { in: ids }, ownerUserId: userId } });
  if (owned !== ids.length) return res.status(400).json({ code: 'INVALID_CONTACTS' });

  const existing = await prisma.contactGroup.findFirst({
    where: {
      ownerUserId: userId,
      members: { every: { contactId: { in: ids } } },
      AND: ids.map((id) => ({ members: { some: { contactId: id } } })),
    },
    select: { id: true, name: true, image: true },
  });

  if (existing) {
    return res.status(200).json({ existed: true, group: existing });
  }

  const created = await prisma.contactGroup.create({
    data: {
      ownerUserId: userId,
      name,
      image: image ?? '',
      members: { create: ids.map((contactId) => ({ contactId })) },
    },
    select: { id: true, name: true, image: true },
  });

  return res.status(201).json({ existed: false, group: created });
});

export default router;
