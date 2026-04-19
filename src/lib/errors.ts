// 예상 가능한(유저 입력/상태 기반) 에러들.
// Sentry로 보내지 않고, 클라이언트에 적절한 status로 응답하기 위한 용도.
// 진짜 예상 못한 에러(DB, 외부 API 등)는 그냥 throw 하면 Sentry가 잡는다.

export class AppError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized', code?: string) {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code?: string) {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code?: string) {
    super(message, 404, code);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input', code?: string) {
    super(message, 400, code);
  }
}
