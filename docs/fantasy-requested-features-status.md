# 기나긴 여정 — 요청 기능 구현 현황

2026-10-28 작업 기준. 요청은9개 묶음이며, 각 항목의 현재 상태와 남은 일을 구분해 기록한다.

## 요약

| # | 요청 | 상태 | 남은 일 |
| --- | --- | --- | --- |
| 1 | 행동 중간 취소 | 완료 | 없음 |
| 2 | 다지역 이동 시 경유지 안개 | 완료 | 없음 |
| 3 | 이동 중 습격 | 완료 | 파티 동반 호위 전투·자동 참전(후속) |
| 4 | 이동 중 목적지 변경 | 핵심 완료 | 파티 승인 절차, 수단 전환 UI, 경유지 기준 거리 |
| 5 | UI 가독성·툴팁·접이식 메뉴 | 완료 | 브라우저 실물 확인 |
| 6 | 파티 조사 판정 공유 | 미착수 | 기존 "독립 조사" 테스트 재작성 선행 |
| 7 | 파티장 권한·승인 흐름 | 대부분 완료 | 불참자 퀘스트 진행 인정, 퀘스트창 전투 시작 |
| 8 | 주사위 창·소리·모션 | 완료 | 없음 |
| 9 | 전투 장애물·기술 | 데이터 완료 | 배치·타겟팅·파괴·방패 기술·기술 목록 |

## 1. 행동 중간 취소

- `cancel` 액션. 진행 표시줄의 취소 버튼을 두 번 눌러 확정.
- 이미 판정이 끝난 작업 손번의 금화·경험치는 유지, 완료 시점 보상·의뢰·조사·이동·숙련은 미지급.
- 호위 이동은 취소 불가(포기 절차 사용).
- 파일: `shared/fantasy-engine.ts`, `server/fantasy-store.ts`, `client/src/world/FantasyActivity.tsx`
- 테스트: `shared/fantasy-cancel.test.ts`

## 2. 경유지 안개

- 두 지역 이상 지나는 이동에서 경유지 주변을 `seen`에 저장해 지도 안개를 걷는다. `visited`에는 넣지 않아 지도 제작·의뢰 조건을 앞당기지 않는다.
- 파일: `shared/fantasy-engine.ts`, `shared/fantasy-town.ts`, `server/fantasy-store.ts`
- 테스트: `shared/fantasy-fog.test.ts`

## 3. 이동 중 습격

- 실제10초(게임5분)마다3% 판정. 발생 시 그 시각에 이동 중단, 현재지에서 적대 조우 대응.
- 호위는9%(일반의3배). 호위 소요 시간은 도보의1.25배로 일반 마차(0.5배)보다 느리다.
- 파티는 이동 씨앗을 통일해 같은 시각·같은 조우를 받는다.
- 호위 이동의 습격은 전용 조우(`encounter-escort-ambush`)로 열린다. 싸우면 `source: escort:<계약ID>`의 수레 전술 전투로 이어지고, 수레 HP0이면 계약 실패, 승리하면 계약을 유지한 채 다시 출발한다. 도망·대화는 전투 없이 조우만 끝내고 계약은 유지된다.
- 실제 서버에서만 동작(`StoreOptions.ambush`). 테스트는 결정적.
- 파일: `shared/fantasy-ambush.ts`, `shared/fantasy-encounters.ts`, `shared/fantasy-engine.ts`, `shared/fantasy-combat-challenges.ts`, `server/fantasy-store.ts`, `server/index.ts`
- 테스트: `shared/fantasy-ambush.test.ts`, `shared/fantasy-encounters.test.ts`, `shared/fantasy-combat-challenges.test.ts`, `server/fantasy-escort-integration.test.ts`

## 4. 이동 중 목적지 변경

- `redirect` 액션. 이동 중에만 가능.
- 도보·비공정은 새 목적지로 재출발, 정기 마차는 내려서 도보.
- 배(정기선·手伝い船)와 호위는 변경 불가.
- 운임은 도착 시 지급 규칙 유지 → 중도 하차 시 지급·환불 없음.
- 호위 포기 위약금: 보수의 절반(최소1G), 소지금 부족 시 가진 만큼. `escortPenalty`로 저장·표시.
- 파일: `shared/fantasy-engine.ts`, `shared/fantasy-escort.ts`, `server/fantasy-store.ts`, `client/src/world/FantasyActivity.tsx`, `client/src/world/FantasyEscortPanel.tsx`
- 테스트: `shared/fantasy-redirect.test.ts`, `shared/fantasy-travel-contracts.test.ts`

## 5. UI 가독성

- 오른쪽 패널이 남은 화면의 약5분의2(3:2). 접기 버튼으로38px 레일까지 접힌다.
- 비활성 사유를 화면 오른쪽 아래 고정 안내판으로 옮겨 잘림 제거.
- 파일: `client/src/world/fantasy.css`, `fantasy-action-help.css`, `FantasyPanel.tsx`

## 6. 파티 조사 판정 공유

- 구현 시도 후 되돌림. 기존 테스트 2개가 "각자의 조사 결과는 독립"을 전제로 하고, 개인 정보 비공개 검증까지 포함해 함께 고쳐야 한다.
- 다음 순서: ①테스트를 "판정 공유·정보 비공개" 규칙으로 재작성 ②공유 로직 재적용(검증된 코드 있음) ③함정·회복 기믹은 개인 판정 유지 확인.

## 7. 파티장 권한·승인

- 파티를 만든 사람이 파티장. 양도·추방 추가(추방 시 준비·동의·예치금 정리).
- 전투는 파티장 제안 → 파티원 수락·거절·참여하지 않음 3택. 전원 결정 + 최소1명 수락 시 시작, 거절·불참자는 제외.
- 기존 "전투 중 합류" 버튼 제거.
- 파일: `shared/fantasy-party.ts`, `server/fantasy-party.ts`, `client/src/world/FantasyPartyPanel.tsx`, `FantasyPartyExtras.tsx`
- 테스트: `server/fantasy-party.test.ts`

## 8. 주사위 연출

- 굴림2.5초, 결과5.5초 유지. 카드에 마우스를 올리면 자동 닫힘 중지.
- 굴러가는 소리(WebAudio 합성) 추가, 기존 회전 모션 유지.
- 파일: `client/src/world/FantasyDice.tsx`, `sounds.ts`

## 9. 전투 장애물

- 장애물8종 등록: 굵은 넝쿨·바위·큰 얼음·구멍·낮은 담·쓰러진 통나무·무너진 잔해·술통.
- 각 종류마다 파괴 가능 여부, 내구도, 취약 속성(불·냉기·타격·관통), 통과 방식(차단·하단·상단), 엄폐·시야 차단.
- 취약 속성 피해2배, 소형·비행은 구멍·낮은 장애물 통과, 비행·대형은 잔해·술통 월등.
- 아직 전투 판정에 연결하지 않았다. 다음 작업: 전장 배치, 클릭 타겟팅, 공격으로 파괴, 장애물 밀집 필드+원거리 적, 방패병 임시 엄폐·피해 감소, 직업·종족 기술 효과 목록.
- 파일: `shared/fantasy-obstacles.ts`
- 테스트: `shared/fantasy-obstacles.test.ts`

## 검증 기록

- 타입 검사`tsc --noEmit` 통과(0오류).
- 판타지 회귀 테스트1,033개(104파일) 통과.30파일씩 나눠 실행했다.
- 클라이언트 빌드`vite build` 성공.
- 실제 브라우저에서의 시각 확인은 하지 않았다. 특히UI 배치·툴팁 위치·주사위 소리는 미확인이다.
