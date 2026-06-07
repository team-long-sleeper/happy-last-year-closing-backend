import express from 'express';
import { z } from 'zod';
import { prisma } from '@lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { groupBySection } from '../utils/hangul.js';

const router = express.Router();

const ContactItem = z.object({
  type: z.literal('contact'),
  id: z.string(),
  name: z.string(),
  profileImage: z.string().nullable(), // Contact.profileImage 은 nullable
  social: z.enum(['KAKAO', 'GOOGLE', 'NAVER']).nullable(),
});

const GroupItem = z.object({
  type: z.literal('group'),
  id: z.string(),
  name: z.string(),
  profileImage: z.string(), // ContactGroup.image 은 required
  membersCount: z.number(),
});

const ContactListItem = z.discriminatedUnion('type', [ContactItem, GroupItem]);
type ContactListItem = z.infer<typeof ContactListItem>;

// 가나다 섹션 단위 응답: [{ key: "ㄱ", items: [...] }, ...]
const ContactSection = z.object({
  key: z.string(), // 초성 (ㄱ~ㅎ) 또는 '#'
  items: z.array(ContactListItem),
});
type ContactSection = z.infer<typeof ContactSection>;

// 연락처 + 그룹을 합쳐 가나다(초성) 섹션으로 반환
// [ { key: "ㄱ", items: [{type:'contact'|'group', ...}] }, ... ]
router.get('', requireAuth, async (req, res) => {
  const ownerUserId = req.auth!.userId;
  console.log(ownerUserId);

  const [contacts, groups] = await Promise.all([
    prisma.contact.findMany({
      where: { ownerUserId },
      select: { id: true, name: true, profileImage: true, provider: true },
    }),
    prisma.contactGroup.findMany({
      where: { ownerUserId },
      select: {
        id: true,
        groupName: true,
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
      profileImage: c.profileImage,
      social: c.provider,
    })),
    ...groups.map((g) => ({
      type: 'group' as const,
      id: g.id,
      name: g.groupName,
      profileImage: g.image,
      membersCount: g._count.members,
    })),
  ];

  const sections: ContactSection[] = groupBySection(items);
  res.json(sections);
});

router.get('/groups/:id', requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const groupId = req.params.id;

  if (typeof groupId !== 'string') {
    return res.status(400).json({ error: 'Invalid group id' });
  }

  const group = await prisma.contactGroup.findFirst({
    where: { id: groupId, ownerUserId: userId },
    select: {
      id: true,
      groupName: true,
      image: true,
      _count: { select: { members: true } },
      members: {
        orderBy: { name: 'asc' },
        select: { id: true, name: true, profileImage: true, provider: true },
      },
    },
  });

  if (!group) return res.status(404).json({ message: 'not found' });

  return res.json({
    id: group.id,
    name: group.groupName,
    profileImage: group.image,
    members: group.members,
    membersCount: group._count.members,
  });
});

export default router;
