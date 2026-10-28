# 다음 작업 인수인계 — 기나긴 여정

새 세션(또는 다른 PC)에서 이 문서만 읽고 이어서 작업할 수 있게 정리했다. **2026-10-28 15:45 기준**, 작업 3b(습격→호위 수레 전투) 완료 직후.

## 프로젝트와 실행

- 원본: `E:\tonarium2` (Tonarium의 `fantasy` 월드 = '기나긴 여정')
- 백업: `E:\tonarium-backups\tonarium2-2026-10-28_1232\` (전체 트리 + git 번들). 12:32 시점이라 그 뒤의 변경분(작업 3b 포함)은 들어 있지 않다. 되돌릴 때만 쓴다.
- **Node.js 24 필수**. 시스템 기본 `node`는 v18이라 `tsc`가 깨진다.
  - 번들 노드: `C:\Users\user222\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
  - 타입 검사: `& $node 'E:\tonarium2\node_modules\typescript\lib\tsc.js' --noEmit -p 'E:\tonarium2\tsconfig.json'`
  - 테스트: `& $node 'E:\tonarium2\node_modules\tsx\dist\cli.mjs' --test <파일...>`
  - 빌드: `& $node 'E:\tonarium2\node_modules\vite\bin\vite.js' build`
- **샌드박스 주의**: 파일 쓰기(E: 드라이브)뿐 아니라 `tsx`/`vite` 실행도 `danger-full-access` 승인이 필요하다. 샌드박스 안에서는 esbuild가 자식 프로세스를 못 띄워 `spawn EPERM`으로 실패한다.
- 테스트는 104개 파일을 한 번에 돌리면 멈춘다. **30개씩 나눠 실행**할 것(아래 명령 참고).
- 현재 작업 트리는 **커밋하지 않았다**(마지막 커밋 `cccc032`, 그 위에 31개 수정 + 신규 파일). `git checkout`/`reset`으로 되돌리지 말 것.
- 다른 PC로 옮길 때는 저장소 전체(또는 `git bundle`)를 복사하고 Node 24 + `npm ci`로 의존성을 설치한다. 이 문서의 경로는 `E:\tonarium2` 기준이니 환경에 맞게 바꾼다.

## 현재 상태 요약

| # | 기능 | 상태 |
| --- | --- | --- |
| 1 | 행동 중간 취소 | 완료 |
| 2 | 경유지 안개(`seen`) | 완료 |
| 3 | 이동 중 습격(3%/호위9%) | 완료 |
| 3b | 습격→호위 수레 전투 | **완료(이번 작업)** |
| 4 | 목적지 변경·호위 위약금 | 완료 |
| 5 | UI(오른쪽 2/5·접이식·툴팁) | 완료(브라우저 미확인) |
| 7 | 파티장 양도·추방·전투 3택 | 완료 |
| 8 | 주사위 2.5초/5.5초·소리 | 완료(브라우저 미확인) |
| 9a~9e | 장애물 데이터·배치·파괴·엄폐·클릭 타겟팅 | 완료 |
| 4(잔여) | 파티 이동 목적지 변경 승인 | 미착수 |
| 5(잔여) | 파티 조사 판정 공유 | 미착수(테스트 선행) |
| 6(잔여) | 불참자 퀘스트 진행 인정 | 미착수 |

완료된 기능의 파일·테스트는 아래 표를 따른다. **건드리지 말 것.**

| # | 핵심 파일 | 테스트 |
| --- | --- | --- |
| 1 | `shared/fantasy-engine.ts`, `server/fantasy-store.ts`, `client/src/world/FantasyActivity.tsx` | `shared/fantasy-cancel.test.ts` |
| 2 | `shared/fantasy-engine.ts`, `shared/fantasy-town.ts` | `shared/fantasy-fog.test.ts` |
| 3 | `shared/fantasy-ambush.ts`, `shared/fantasy-encounters.ts`, `shared/fantasy-engine.ts` | `shared/fantasy-ambush.test.ts` |
| 3b | `shared/fantasy-encounters.ts`, `shared/fantasy-engine.ts`, `shared/fantasy-combat-challenges.ts`, `server/fantasy-store.ts` | `shared/fantasy-ambush.test.ts`, `shared/fantasy-encounters.test.ts`, `shared/fantasy-combat-challenges.test.ts`, `server/fantasy-escort-integration.test.ts` |
| 4 | `shared/fantasy-engine.ts`, `shared/fantasy-escort.ts` | `shared/fantasy-redirect.test.ts`, `shared/fantasy-travel-contracts.test.ts` |
| 5 | `client/src/world/fantasy.css`, `FantasyPanel.tsx` | - |
| 7 | `shared/fantasy-party.ts`, `server/fantasy-party.ts`, `FantasyPartyPanel.tsx` | `server/fantasy-party.test.ts` |
| 8 | `client/src/world/FantasyDice.tsx`, `sounds.ts` | - |
| 9a~9e | `shared/fantasy-obstacles.ts`, `fantasy-combat-tactics.ts`, `fantasy-combat.ts`, `FantasyTacticalBoard.tsx` | `shared/fantasy-obstacles.test.ts`, `fantasy-tactics-obstacles.test.ts` |

## 3b. 습격→호위 수레 전투 (이번에 구현한 것)

호위 이동 중 습격이 나면 전용 조우가 열리고, 싸우면 수레가 포함된 `source: escort:<계약ID>` 전투로 이어진다.

- **조우**: `FANTASY_ESCORT_AMBUSH_ENCOUNTER = 'encounter-escort-ambush'` (`shared/fantasy-encounters.ts`). 이름 '호송 수레를 노리는 습격자', 사람 상대(fight/escape/talk). `FANTASY_HOSTILE_ENCOUNTERS`에 추가되어 `FANTASY_EVENTS` 총계가 261→**262**가 됐다.
- **원인 구분**: `shared/fantasy-engine.ts`의 `advanceFantasyWorld`가 `activity.action.transport === 'escort'`일 때 `confront(next, 'escort-ambush')`로 전용 조우를 열고, 로그도 '護送中の隊列が襲撃を受け、足を止めた。'로 남긴다. 일반 이동은 기존 `travel-ambush` 그대로다.
- **전투 계획**: `shared/fantasy-combat-challenges.ts`의 `fantasyCombatStartPlan`이
  - `kind:'escort'`(출발 전 방어)과
  - `kind:'encounter', target:'encounter-escort-ambush'`(이동 중 습격)
  을 모두 `source: escort:<계약ID>`, 적 1명(`road-ambusher`, 레벨 3/7 기준으로 slime→wolf→goblin-raider)으로 계획한다. `profile.event`가 실제로 그 조우일 때만 성립하므로 다른 조우로는 수레 전투가 열리지 않는다.
- **서버**: `server/fantasy-store.ts`
  - `startCombat`이 계획의 source가 `escort:`로 풀리면 `startEscortCombat`으로 위임한다(단독 시작만; 여러 명 동시 시작은 `incompatible`).
  - `startEscortCombat`은 (a) 출발 전 `defense:'pending'` 방어와 (b) `event === 'encounter-escort-ambush'`인 이동 중 습격을 모두 받는다. 계약ID가 실제 소유 계약과 일치해야 하고, 습격 전투를 시작할 때 `profile.event`를 `null`로 지우고 로그 '護送隊への襲撃だ。馬車を守り抜け。'를 남긴다.
  - 전투 종료 처리(`applyCombatResult`)는 수레 HP>0 승리면 계약 유지(`defense:'cleared'`), 패배·도주면 계약 삭제. 승리 로그는 출발 전이면 '護衛隊の出発路を確保した。', 습격이면 '護送隊を守り抜いた。旅を続けられる。'.
- **플레이 흐름**: 습격 발생 → 이동 중단(원지) → 조우에서 `fight` 선택 → 수레 전투 → 승리 시 계약 유지·재출발, 수레 HP 0이면 계약 실패. `escape`/`talk`로 조우를 끝내면 전투 없이 계약만 유지된다(재출발 가능).
- **테스트**: `server/fantasy-escort-integration.test.ts`에 (1) 결정적 seed로 실제 tick 습격을 일으켜 `startCombat(source:'encounter')`이 수레 전투로 이어지고 수레 HP 0에서 패배·계약 삭제되는 흐름, (2) 평범한 조우(`encounter-woodland-wolf`)로는 수레 전투가 열리지 않는 회귀를 추가했다.

### 이번에 수정한 파일

`shared/fantasy-encounters.ts`, `shared/fantasy-engine.ts`, `shared/fantasy-combat-challenges.ts`, `server/fantasy-store.ts`, `shared/fantasy-ambush.test.ts`, `shared/fantasy-encounters.test.ts`, `shared/fantasy-combat-challenges.test.ts`, `server/fantasy-escort-integration.test.ts`, `docs/fantasy.md`, `docs/fantasy-escort-tactics.md`, `docs/fantasy-current-status.md`, `docs/fantasy-requested-features-status.md`, `docs/world-bible.md`, `docs/fantasy-expansion-plan.md`, `docs/fantasy-expansion-candidates.md`, `docs/fantasy-interface.md`, 이 문서.

## 검증 (2026-10-28 이번 세션)

- `tsc --noEmit`: 0 오류.
- 판타지 테스트 **1,033개 / 104파일 전부 통과**(30파일씩 4묶음, 각 묶음 `fail 0`).
- `vite build`: 성공(청크 크기 경고만 있음).
- `node scripts/check-changelog.mjs`: 성공(변경 이력 없음).
- `tsx scripts/content-translations.ts validate`: `Content metadata valid: 39 registered documents.`
- **브라우저 실물 확인은 하지 않았다.** 조우→수레 전투 화면, 9e 클릭 타겟팅, UI 배치·툴팁 위치, 주사위 소리는 미확인이다.

### 전체 판타지 테스트 실행 예

```powershell
$node='C:\Users\user222\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$all = Get-ChildItem -Recurse -Filter '*.test.ts' -Path shared,server,client/src |
  Where-Object { $_.Name -match 'fantasy' } | Sort-Object FullName | ForEach-Object { $_.FullName }
# 30개씩 4묶음으로 실행(전체를 한 번에 넘기면 멈춤)
foreach ($i in 0..3) {
  $start=$i*30; $end=[Math]::Min($start+29,$all.Count-1); if ($start -ge $all.Count) { break }
  & $node 'E:\tonarium2\node_modules\tsx\dist\cli.mjs' --test @($all[$start..$end])
}
```

## 남은 작업 (이어서 할 것)

### 4. 파티 이동 목적지 변경 승인

- 목표: 파티장이 새 목적지를 제안 → 파티원 전원 동의 → 전원이 같은 시각에 `redirect`로 함께 방향을 바꾼다.
- 시작 지점: `server/fantasy-party.ts`의 기존 `readyTravel`/`startTravel` 패턴을 복제해 `redirectTravel`(제안)·동의 저장·`startRedirect`를 추가. `shared/fantasy-party.ts`의 상태·검증 타입, `client/src/world/FantasyPartyPanel.tsx`/`FantasyPartyExtras.tsx`의 버튼·표시도 함께.
- 저장소 쪽: 전원의 진행 중 활동을 같은 시각에 바꿔야 하므로 `server/fantasy-store.ts`에 `startGroupRedirect`(예: `startGroupTravel` 참고)를 추가하고, `applyFantasyAction`의 `redirect` 규칙(배·호위는 불가, 마차는 도보로)을 그대로 적용한다. 원자적 저장·실패 시 무변경을 기존 패턴대로 유지.
- 완료 조건: 파티장 제안 → 전원 동의 → 전원 동시 `redirect`(거절·만료 시 아무 변화 없음). `server/fantasy-party.test.ts`에 결정적 테스트 추가.

### 5. 파티 조사 판정 공유

- **선행**: `server/fantasy-party.test.ts`의 "independent same-duration personal investigations"와 "completion-save failure publishes no partial clue" 두 테스트를 "판정 공유·정보 비공개" 규칙으로 재작성한다.
- 이후: `FantasyStore.startGroupInvestigation`에서 그룹(같은 퀘스트·단계·시각의 참가자)을 기억하고, 조사 완료 시 `mainTrials[quest].proofs`에 같은 단계 증거가 있는 동료의 증거를 복사한다(로그: 동료의 조사 결과 공유). 개인 기믹(함정·회복)은 개인 판정 유지.
- 주의: 완료 저장 실패 시 일부 증거만 발행되지 않아야 한다. 이전 시도에서 로직은 동작했으나 위 테스트 충돌로 되돌렸다.

### 6. 불참자 퀘스트 진행 인정

- 파티 전투 승리 시, 같은 파티의 거절·불참자에게 해당 단계 증거를 전달한다.
- 시작 지점: `server/fantasy-store.ts`의 `applyCombatResult`(승리 처리). 저장소는 파티 상태를 모르므로 `FantasyParty`를 조회할 수 있는 콜백/프로바이더를 `StoreOptions`에 두거나, `server/index.ts`에서 전투 결과 커밋 후 파티 단위로 적용하는 설계를 먼저 정한다(단일 저장 원자성 고려).
- 완료 조건: 승리 시 참가자·불참자 모두 같은 단계 증거를 받고, 거절자는 제외하지 않는다. 중복 지급·재시작 내구성 테스트 포함.

## 규칙과 주의

- `changelog/`와 `shared/changelog.ts`는 **수정 금지**(`check:changelog`가 develop 기준으로 막는다).
- 기능·조작·구성을 바꾸면 해당 `docs/`를 같은 작업에서 갱신한다. 등록 사건 수를 바꾸면 `docs/fantasy.md`, `docs/fantasy-current-status.md`, `docs/world-bible.md`, `docs/fantasy-expansion-plan.md`, `docs/fantasy-expansion-candidates.md`, `docs/fantasy-interface.md`의 262 표기도 함께 고친다.
- 현황 문서: `docs/fantasy-requested-features-status.md`. 작업 후 표·검증 기록을 갱신한다.
- 각 작업 후 `tsc` + 관련 테스트 + `vite build`를 돌린다. 브라우저 확인은 선택이지만, UI·툴팁·주사위 소리는 아직 미확인임을 계속 명시한다.
- 3b로 104개 판타지 테스트 묶음이 이미 1,033개다. 파일을 추가하면 위 묶음 명령의 개수만 바뀌고 방식은 그대로 쓰면 된다.
- 향후 파티 동반 호위 전투(여러 명이 한 수레 전투를 함께 시작)는 3b에서 의도적으로 단독 시작만 허용했다. 필요하면 `createFantasyEscortBattle`의 지휘권(owner/leader) 규칙과 `startCombat`의 다인 시작을 함께 확장해야 한다. 현재는 단독 시작 후 다른 파티원이 `joinCombat`으로 합류하는 방식만 지원한다.
