---
name: node-backend-review
description: Review Node.js/Express/Prisma/PostgreSQL backend code for common issues — missing error handling, Prisma N+1 queries, transaction misuse, insecure API design, unvalidated inputs, env/secret exposure, and poor async patterns. Use this skill whenever the user shares backend code (Express routes, Prisma queries, middleware, controllers, utility modules) or asks for a code review on server-side code. Trigger even when the user pastes a `.ts` file without explicitly saying "review" — proactively offer a structured review. Also trigger for questions like "이 코드 어때?", "리팩토링 해줘", "PR 봐줘", "백엔드 리뷰해줘", "API 설계 봐줘", or any code-quality discussion on Node.js/Express/Prisma code.
---

# Node.js / Express / Prisma Backend Code Review

This skill reviews Node.js backend code against a focused set of high-impact issues. The target stack is:

- Node.js + TypeScript
- Express (with BFF pattern if applicable)
- Prisma ORM + PostgreSQL
- Cloudflare R2 (storage)
- NextAuth.js / JWT (auth)
- Zod (validation)

## How to use this skill

When the user shares backend code:

1. **Read the code carefully.** Identify which checks below apply. Do not force findings.
2. **Classify each issue by severity:**
   - **Critical** (치명) — security holes, data loss risk, crashes in production, broken auth
   - **Major** (주요) — wrong patterns that hurt correctness, performance, or maintainability
   - **Advisory** (어드바이스) — style, naming, minor improvements
3. **For each issue, provide:**
   - **Where** — file path + line range (or quoted snippet)
   - **What** — one-sentence problem description
   - **Why** — short rationale (1-2 sentences). Explain the principle, not just the rule.
   - **Fix** — actual corrected code
4. **Output format:** start with a 1-2 line summary, then group by severity: `## 치명 (Critical)`, `## 주요 (Major)`, `## 어드바이스 (Advisory)`. Omit empty sections.
5. **End with a single "Overall" paragraph** — 2-3 sentences on general quality and what to prioritize. If the code is fine, say so plainly.

Always respond in the same language the user wrote in.

**When the user asks "why?"** — open `references/concepts.md` and find the matching section. Explain in your own words from that section; don't dump the document.

## Checks

Run only checks that apply. Don't force findings.

### 1. 에러 핸들링 (Error Handling)

Express에서 가장 자주 빠지는 부분이다.

- **async route handler에 try-catch 없거나 next(err) 없는 경우** → unhandled promise rejection으로 서버 크래시 가능. `express-async-errors` 쓰거나 직접 감싸야 한다.
- **에러를 `console.error` 만 하고 클라이언트에 응답 안 하는 경우** → request가 hanging 상태로 남는다.
- **모든 에러에 500만 반환** → 클라이언트가 에러 원인 구분 불가. 4xx/5xx 구분이 필요하다.
- **Prisma 에러를 그대로 클라이언트에 내려보내는 경우** → DB 스키마/구조 노출. 치명.

  ```ts
  // ❌ Prisma 에러 그대로 응답
  catch (e) { res.status(500).json({ error: e }) }

  // ✅
  catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return res.status(409).json({ error: '이미 존재하는 데이터입니다' });
    }
    next(e); // 글로벌 에러 핸들러로
  }
  ```

- **글로벌 에러 핸들러(`app.use((err, req, res, next) => ...)`)가 없는 경우** → Express 기본 에러 응답이 HTML로 내려가서 클라이언트가 파싱 실패.

### 2. Prisma N+1 / 쿼리 최적화

- **루프 안에서 `prisma.xxx.findUnique` 호출** → N+1. `include`/`select`로 관계를 한 번에 로딩하거나 `findMany`로 일괄 조회.

  ```ts
  // ❌
  const posts = await prisma.post.findMany();
  for (const post of posts) {
    const author = await prisma.user.findUnique({ where: { id: post.userId } });
  }

  // ✅
  const posts = await prisma.post.findMany({ include: { user: true } });
  ```

- **필요 없는 필드까지 `select` 없이 전체 조회** → 응답 크고 민감한 필드 노출 위험.
- **`$queryRaw` 사용 시 템플릿 리터럴 문자열 직접 삽입** → SQL injection 가능. `Prisma.sql` 태그드 템플릿 사용.
- **병렬로 실행 가능한 독립 쿼리를 순차 `await`** → `Promise.all`로 묶어야 한다.

  ```ts
  // ❌
  const user = await prisma.user.findUnique(...);
  const posts = await prisma.post.findMany(...);

  // ✅
  const [user, posts] = await Promise.all([
    prisma.user.findUnique(...),
    prisma.post.findMany(...),
  ]);
  ```

### 3. 트랜잭션 처리

- **여러 테이블 write가 트랜잭션 없이 분리된 경우** → 중간에 실패하면 데이터 불일치.

  ```ts
  // ❌
  await prisma.order.create(...);
  await prisma.inventory.update(...); // 여기서 실패하면 order만 생성됨

  // ✅
  await prisma.$transaction([
    prisma.order.create(...),
    prisma.inventory.update(...),
  ]);
  ```

- **인터랙티브 트랜잭션(`$transaction(async (tx) => ...)`)에서 외부 Prisma 클라이언트(`prisma.xxx`) 호출** → tx 범위 밖 쿼리라 트랜잭션 의미 없음.
- **트랜잭션 안에서 네트워크 요청(외부 API, S3 등)** → 트랜잭션 시간이 길어지고 DB connection 고갈 가능.

### 4. 입력 검증 / Zod

- **`req.body`를 검증 없이 바로 Prisma에 넘기는 경우** → 임의 필드 injection 가능.

  ```ts
  // ❌
  await prisma.user.update({ data: req.body });

  // ✅
  const parsed = UpdateUserSchema.parse(req.body);
  await prisma.user.update({ data: parsed });
  ```

- **Zod 스키마가 있지만 `safeParse` 결과를 `success` 체크 없이 `.data` 접근** → 타입이 틀렸을 때 undefined 흘러감.
- **쿼리 파라미터(숫자 id 등)를 문자열 그대로 Prisma에 넘기는 경우** → Prisma가 타입 에러 or NaN.

  ```ts
  // ❌
  const id = req.params.id; // string
  prisma.post.findUnique({ where: { id } }); // id가 Int면 에러

  // ✅
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  ```

- **파일 업로드 시 mimetype/size 검증 없음** → 임의 파일 업로드 가능.

### 5. 보안 / 인증

- **인증 미들웨어가 없는 private route** → 누구나 접근 가능.
- **JWT 검증 없이 `req.user`를 신뢰하는 경우** → 세션 위조 가능.
- **환경변수 없을 때 fallback을 빈 문자열/하드코딩 값으로 쓰는 경우**:

  ```ts
  // ❌
  const secret = process.env.JWT_SECRET || '';

  // ✅
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  ```

- **응답에 민감한 필드(password hash, token, secret key) 포함** → Prisma `select`로 명시적 제외.
- **CORS를 `origin: '*'` 로 설정하면서 credentials: true** → 브라우저가 차단하고 보안 구멍.
- **R2/S3 pre-signed URL 생성 시 만료 시간이 너무 길거나 없음** → URL 유출 시 무기한 접근 가능.

### 6. 비동기 패턴

- **`Promise.all` 대신 `for...of` + `await` 순차 실행** → 병렬화 가능한 작업이 직렬화됨. (Check 2와 겹치면 한 번만 언급)
- **`Promise.allSettled` 써야 할 곳에 `Promise.all`** → 하나 실패하면 나머지 결과도 버려짐.
- **callback 기반 API를 `util.promisify` 없이 async 함수 안에 섞어 쓰는 경우** → 에러 처리 구멍.
- **`async` 함수 안에서 `new Promise()` wrapper로 중첩** → 이미 async면 그냥 await 하면 됨.

### 7. 코드 구조 / 유지보수

- **route 파일 한 곳에 비즈니스 로직 + DB 쿼리 + 응답 처리가 다 있는 경우** → router → controller → service 레이어 분리 제안.
- **하드코딩된 숫자/문자열 상수** (pagination 기본값, 파일 크기 제한 등) → 상수 파일로 추출.
- **`any` 타입 남발** → `unknown` + 타입 가드, 또는 Zod 추론 타입으로 대체.
- **미들웨어 순서가 잘못된 경우** (예: 인증 미들웨어가 라우터 뒤에 등록) → 의도대로 동작 안 함.

## What NOT to do

- 코드를 다시 다 적어주지 마라. 지적한 부분만 수정 코드로 보여줘라.
- "고려해보세요", "검토해보세요" 금지. 구체적인 수정 코드 제시.
- 발견 못 한 이슈를 만들지 마라. 코드가 깔끔하면 깔끔하다고 말하라.
- Prettier/ESLint 영역(들여쓰기, 세미콜론)은 지적하지 마라.

## Example output

```
요약: 인증 없는 private route 1건(치명), N+1 쿼리 1건(주요). 나머지는 양호.

## 치명 (Critical)

### 1. `src/routes/post.ts:15` — 인증 미들웨어 누락
**문제:** POST /posts 라우트에 authMiddleware가 없어서 비인증 요청도 처리됨.
**수정:**
\`\`\`ts
router.post('/posts', authMiddleware, createPost);
\`\`\`

## 주요 (Major)

### 2. `src/services/post.service.ts:32` — 루프 내 Prisma 쿼리 (N+1)
**문제:** posts 배열을 순회하며 각 post의 author를 개별 쿼리로 가져옴.
**수정:**
\`\`\`ts
const posts = await prisma.post.findMany({ include: { user: { select: { id: true, name: true } } } });
\`\`\`

## Overall

전반적인 구조는 깔끔하다. 인증 미들웨어만 빠짐없이 체크하면 production 품질에 가깝다.
```
