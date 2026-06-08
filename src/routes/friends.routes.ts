import { prisma } from '@lib/prisma.js';
import express from 'express';
import { z, flattenError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pickRandomDefaultProfileImage } from '../utils/defaultProfileImage.js';

const CreateContactBody = z.object({
  name: z.string().min(1).max(50),
});

// DELETE /friends — 여러 연락처 일괄 삭제
const DeleteContactsBody = z.object({
  contactsId: z.array(z.uuid()).min(1).max(100), // 무제한 삭제 방지 상한
});

const router = express.Router();

router.get('', requireAuth, async (req, res) => {
  const contacts = await prisma.contact.findMany({
    where: { ownerUserId: req.auth!.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      image: true,
      linkedUser: {
        select: {
          id: true,
          profileImage: true,
          oauthAccounts: {
            select: {
              provider: true,
            },
          },
        },
      },
    },
  });

  const dataResult = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    image: c.image,
    social: c.linkedUser ? c.linkedUser.oauthAccounts.map((p) => p.provider) : null,
  }));

  return res.status(200).json(dataResult);
});

router.post('', requireAuth, async (req, res) => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid Body', errors: flattenError(parsed.error) });
  }

  const { name } = parsed.data;

  const newContact = await prisma.contact.create({
    data: {
      name,
      owner: { connect: { id: req.auth!.userId } },
      image: pickRandomDefaultProfileImage(),
    },
  });

  return res.status(201).json(newContact);
});

router.delete('', requireAuth, async (req, res) => {
  const parsed = DeleteContactsBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid Body', errors: flattenError(parsed.error) });
  }
  const ids = [...new Set(parsed.data.contactsId)];

  // ownerUserId 를 where 에 같이 걸어 "내 연락처만" 삭제 → 남의 id 가 섞여도 무시됨(IDOR 차단).
  // 그룹 멤버(ContactGroupMember)·에피소드 참여(EpisodeMate)는 onDelete: Cascade 로 함께 삭제.
  const { count } = await prisma.contact.deleteMany({
    where: { id: { in: ids }, ownerUserId: req.auth!.userId },
  });

  // 요청 개수와 실제 삭제 개수를 함께 반환 → 프론트가 "일부는 이미 없었음"을 구분 가능.
  return res.status(200).json({ requested: ids.length, deleted: count });
});

export default router;
