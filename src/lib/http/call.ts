import axios, { isAxiosError } from 'axios';

// 외부 HTTP 호출에서 non-2xx 응답을 받았을 때 던지는 에러.
// 상태 코드와 응답 body를 보존해서 호출자가 401/403/... 분기 처리할 수 있게 한다.
// AppError와는 별개 — AppError는 "우리 서버가 클라이언트에 돌려줄 응답"이고,
// HttpError는 "우리가 외부로 나간 호출이 실패한 사실"을 나타낸다.
export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export async function call(
  method: string,
  uri: string,
  param: {} | null,
  header: { 'content-type'?: string; Authorization?: string },
) {
  try {
    const res = await axios({ method, url: uri, headers: header, data: param });
    return res.data;
  } catch (err) {
    // axios는 non-2xx 응답에서도 reject한다. response가 있으면 HTTP 에러,
    // 없으면 네트워크/타임아웃 계열 — 원본을 그대로 올려서 진단 가능하게 한다.
    if (isAxiosError(err) && err.response) {
      throw new HttpError(err.response.status, err.response.data);
    }
    throw err;
  }
}
