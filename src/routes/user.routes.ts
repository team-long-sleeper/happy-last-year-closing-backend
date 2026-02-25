import { call } from '@lib/http/call.js';
import express from 'express';

const router = express.Router();
const api_host = 'https://kapi.kakao.com'; // 카카오 API 호출 서버 주소

// 로그인한 사용자의 정보(회원번호, 닉네임, 프로필 이미지 등)을 요청함
// 발급받은 액세스 토큰을 Authorization 요청 헤더에 넣어서 사용자 정보 조회 API를 호출
// 사용자가 로그인 후 사용자 정보 조회 API 를 호출해야 사용자와 앱이 연결되어 카카오 로그인이 완료됨
router.get('/profile', async function (req, res) {
  const uri = api_host + '/v2/user/me';
  const param = {};
  const header = {
    'content-type': 'application/x-www-form-urlencoded', // 요청 헤더 Content-Type 지정
    Authorization: 'Bearer ' + req.session.key, // 세션에 저장된 액세스 토큰 전달
  };

  const rtn = await call('POST', uri, param, header);

  res.send(rtn);
});

// note 로그아웃 및 연결 해제 구현하기
router.get('/logout', async function (req, res) {
  const uri = api_host + '/v1/user/logout';
  const header = { Authorization: 'Bearer ' + req.session.key };

  const rtn = await call('POST', uri, null, header);
  // todo destroy callback 함수로 뭐 넣어야하는지?
  req.session.destroy(() => {});
  res.send(rtn);
});

router.get('/unlink', async function (req, res) {
  const uri = api_host + '/v1/user/unlink';
  const header = { Authorization: 'Bearer ' + req.session.key };

  const rtn = await call('POST', uri, null, header);
  req.session.destroy(() => {});
  res.send(rtn);
});

export default router;
