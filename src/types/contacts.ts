import { z } from 'zod';

// ===== 응답 스키마 (GET /contacts) =====

const ContactItem = z.object({
  type: z.literal('contact'),
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(), // Contact.image 은 nullable
  social: z.enum(['KAKAO', 'GOOGLE', 'NAVER']).nullable(),
});

const GroupItem = z.object({
  type: z.literal('group'),
  id: z.string(),
  name: z.string(),
  image: z.string(), // ContactGroup.image 은 required
  membersCount: z.number(),
});

export const ContactListItem = z.discriminatedUnion('type', [ContactItem, GroupItem]);
export type ContactListItem = z.infer<typeof ContactListItem>;

// 가나다 섹션 단위 응답: [{ key: "ㄱ", items: [...] }, ...]
export const ContactSection = z.object({
  key: z.string(), // 초성 (ㄱ~ㅎ) 또는 '#'
  items: z.array(ContactListItem),
});
export type ContactSection = z.infer<typeof ContactSection>;

// ===== 요청 바디 스키마 =====

// POST /contacts/group
export const CreateGroupBody = z.object({
  name: z.string().min(1),
  membersId: z.array(z.uuid()).min(1),
  image: z.string().optional(),
});
export type CreateGroupBody = z.infer<typeof CreateGroupBody>;

// /contacts/group/:id 경로 파라미터 — 그룹 id 는 uuid.
export const GroupIdParam = z.object({
  id: z.uuid(),
});
export type GroupIdParam = z.infer<typeof GroupIdParam>;

// PATCH /contacts/group/:id — 부분 수정. 셋 중 하나 이상 필요.
export const PatchGroupBody = z
  .object({
    name: z.string().min(1).optional(),
    image: z.string().optional(),
    membersId: z.array(z.string().uuid()).min(1).optional(),
  })
  .refine((b) => b.name !== undefined || b.image !== undefined || b.membersId !== undefined, {
    message: 'At least one of name, image, membersId is required',
  });
export type PatchGroupBody = z.infer<typeof PatchGroupBody>;
