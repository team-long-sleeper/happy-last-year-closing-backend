import axios from 'axios';

export async function call(
  method: string,
  uri: string,
  param: {} | null,
  header: { 'content-type'?: string; Authorization?: string },
) {
  let rtn;
  try {
    rtn = await axios({
      method,
      url: uri,
      headers: header,
      data: param,
    });
  } catch (err) {
    rtn = (err as any).response;
  }

  return rtn.data;
}
