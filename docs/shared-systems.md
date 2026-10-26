# 중앙 공유 시스템과 코드 맵

이 문서와 [등록 안내](shared-systems-registration.md)가 현재 공유 시스템 구현의 계약이다. 이전 공유 에셋 문서의 시각적 맵 편집기·완성된 오브젝트 배포·맵 제작자의 버전 고정 방식은 이 기능에 적용하지 않는다. 기존 `shared-assets/` 구현은 별도 레거시 경로로 보존한다.

중앙 서버에 등록하는 것은 **오브젝트를 제어할 시스템**이다. 버튼 외형·의자·텍스트의 생성과 배치는 맵 코드가 담당한다. 시스템에는 그 대상에 연결할 동작, 설정, 상태, 입력·출력, 사용 설명을 넣는다. 시스템마다 본체에 개별 import나 ID 분기를 추가하지 않고 공통 실행기가 선언된 명령을 처리한다. 기본 등록 예제는 `button`·`timer`·`chair` 세 가지다.

## 코드에서 맵 작성

`shared/system-map.ts`의 builder로 맵을 작성한다. `shared/system-demo.ts`는 시작·일시정지·초기화 버튼, 타이머 표시, 의자와 착석 버튼 시스템을 연결한 실제 예제다. 시스템 선택에는 ID만 쓰고 버전이나 hash를 작성하지 않는다.

```ts
import { createSystemMap } from './system-map.ts';

export const myMap = createSystemMap('my-map')
  .object({
    id: 'start-switch', capabilities: ['interact'],
    position: [0, 0, -2], size: [0.4, 0.3, 0.4],
  })
  .object({
    id: 'remaining-text', capabilities: ['text'],
    position: [0, 2, -2], text: '00:30',
  })
  .object({
    id: 'my-chair', capabilities: ['interact', 'seat'],
    position: [2, 0.4, -2], seatOffset: [0, 0.4, 0],
  })
  .system({
    instanceId: 'start-control', systemId: 'button',
    bindings: { target: ['start-switch'] }, config: {},
  })
  .system({
    instanceId: 'countdown', systemId: 'timer',
    bindings: { display: ['remaining-text'] }, config: { duration: 30 },
  })
  .system({
    instanceId: 'chair-button', systemId: 'button',
    bindings: { target: ['my-chair'] }, config: {},
  })
  .system({
    instanceId: 'chair-controller', systemId: 'chair',
    bindings: { seat: ['my-chair'] }, config: {},
  })
  .connect({
    from: 'start-control', output: 'pressed',
    to: 'countdown', input: 'start',
  })
  .connect({
    from: 'chair-button', output: 'pressed',
    to: 'chair-controller', input: 'sit', mapping: { user: 'user' },
  })
  .build();
```

맵을 `server/system-maps.ts`의 `systemMaps`에 등록한다. 클라이언트의 `loadSystemMap('my-map')`은 서버에 등록된 맵 코드를 선택한다. 클라이언트가 임의 맵 정의를 올려 중앙 원본을 수정하는 API는 제공하지 않는다. 새 맵의 코드 작성과 시스템 패키지 작성은 다른 작업이다.

## 아이템 메뉴의 아이템을 ID로 배치

아이템 메뉴의 기본 아이템은 `.item(...)`으로 배치한다. `itemId`는 지원하는 기본 아이템 종류 ID이고, `id`는 맵 안의 고유 배치 ID다. 같은 `itemId`를 여러 번 사용해도 서로 다른 `id`를 지정하면 각각 독립된 아이템과 상태를 갖는다. 시스템의 `bindings`에는 메뉴의 `itemId` 대신 이 배치 `id`를 넣는다.

```ts
export const itemMap = createSystemMap('item-map')
  .item({ id: 'chess-table', itemId: 'chess', position: [3, 0, -3] })
  .item({ id: 'greeting', itemId: 'note', position: [-3, 0, -3], text: '어서 오세요!' })
  .item({
    id: 'timer-switch', itemId: 'note', position: [-1, 0, -2],
    itemMode: 'system', capabilities: ['interact'], text: '타이머 시작',
  })
  .item({
    id: 'timer-display', itemId: 'note', position: [1, 0, -2],
    itemMode: 'system', capabilities: ['text'],
  })
  .system({
    instanceId: 'start', systemId: 'button',
    bindings: { target: ['timer-switch'] }, config: {},
  })
  .system({
    instanceId: 'countdown', systemId: 'timer',
    bindings: { display: ['timer-display'] }, config: { duration: 30 },
  })
  .connect({ from: 'start', output: 'pressed', to: 'countdown', input: 'start' })
  .build();
```

`itemMode`는 다음 두 가지다. 생략하면 `native`이며 `capabilities`는 빈 배열이다.

| 모드 | 동작과 제어 |
| --- | --- |
| `native` | 기존 기본 아이템의 기능을 유지한다. 체스를 두고 메모를 편집하는 원래 동작을 사용한다. 직접 이동·운반·수거도 기존 경로를 따른다. 중앙 시스템의 연결 대상과 별도 `solid: true` 시스템 충돌체는 지정할 수 없다. 기존 아이템 자체의 물리는 유지한다. |
| `system` | 기존 기본 아이템의 모델을 중앙 시스템의 대상으로 사용한다. `interact`·`move`·`seat`를 선언할 수 있고, `text`는 메모(`note`)에만 허용한다. 원래의 편집·게임·운반·수거 동작은 사용하지 않고 연결한 시스템이 동작을 정한다. |

현재 지원하는 기본 아이템은 12종으로 `telephone`, `note`, `hammer`, `chess`, `chessAi`, `g2048`, `canvas`, `camera`, `dice`, `antimatter`, `mirror`, `jumpPad`다. 스토어 상품인 `bike`·`talk-card`·`welcome-note`는 공유 시스템의 ID 목록과 맵 배치에서 제외한다. 별도 미디어 초기값이 필요한 `image`·`video`·`youtube`도 지원하지 않는다. 일반 스토어와 기존 아이템 메뉴의 구매·사용 방식은 유지한다.

기존 ID의 대소문자는 그대로 쓰며 `chessAi`와 `chessai`는 다르다. 공유 시스템·맵·배치 ID의 영소문자 규칙과 기본 아이템의 기존 ID 규칙은 별개다. 조회 코드는 `shared/system-items.ts`의 `systemItemDefinitions()`와 `systemItemDefinition(itemId)`다. 이 조회기는 기본 아이템 정의에서 미디어와 스토어 상품에 해당하는 항목을 제외한다. 화면의 **기존 아이템을 ID로 배치하기** 목록에서 현재 지원하는 ID와 이름을 확인한다.

아이템은 현재 바닥에만 배치하므로 `position`의 두 번째 값은 `0`이다. 아이템의 수직 이동도 거부한다. 별도 `.object(...)`로 정의한 일반 오브젝트의 높이는 이 제한을 받지 않는다. 3D 전용 아이템은 기존 2D/3D 사용 범위를 따른다. `system` 모드에서는 점프대의 자동 도약 같은 원래 동작을 추가로 실행하지 않는다.

서버는 맵 배치마다 실제 아이템을 한 번 생성하고 기존 아이템 상태·저장·동기화 경로를 사용한다. 내부 아이템 ID는 `system-map:<맵ID>:<배치ID>`이며 방별로 구분된다. 맵과 배치 ID를 유지하면 반복해서 맵을 불러오거나 서버를 다시 켜도 기존 게임·그림·메모 상태를 초기화하지 않는다. `native`에서 사용자가 옮긴 위치도 작성한 원래 배치 좌표가 같으면 유지한다. 맵 코드의 좌표·회전을 바꾸면 새 배치를 적용한다.

`native` 아이템을 사용자가 수거하면 타이머 갱신 같은 일반 처리에서 다시 만들지 않는다. 작성된 배치를 명시적으로 다시 불러오거나 서버 시작 시 복구하면 다시 생성할 수 있다. 맵을 바꾸면 이전 맵이 소유한 아이템만 정리하며 사용자가 별도로 꺼낸 아이템은 유지한다. 단순 리팩터링에서는 `itemId`와 배치 `id`를 유지하고, 다른 종류로 교체할 때는 새 배치 ID를 사용한다.

## 대상 연결 계약

맵의 모든 오브젝트와 시스템 배치는 안정적인 `id`·`instanceId`를 갖는다. 객체를 다시 생성하거나 이름을 바꾸면 다른 대상으로 취급되므로, 단순한 코드 리팩터링이나 시스템 업데이트에서는 ID를 유지한다.

실행 상태를 이어받는 범위는 같은 맵 ID 안이다. 다른 맵으로 전환하면 이전 배치의 종료 처리를 수행하고 타이머·오브젝트 효과·착석·예약을 정리한 뒤 새 맵을 초기화한다. 서로 다른 맵에서 같은 배치 이름을 사용해도 이전 값이 넘어오지 않는다. 같은 맵을 다시 불러오거나 호환 버전으로 갱신할 때는 기존 상태를 유지한다.

| capability | 시스템이 사용할 수 있는 동작 | 예시 |
| --- | --- | --- |
| `interact` | 지정한 오브젝트와의 상호작용 입력 | 버튼·의자 클릭 |
| `move` | 맵의 원래 위치를 기준으로 위치 이동 | 움직이는 발판 |
| `text` | 지정한 표시 대상의 문자열 변경 | 남은 시간 |
| `seat` | 지정한 착석 지점에 사용자 배치 | 의자 |

`targets`는 연결할 역할의 이름과 필요한 capability, 필수 여부, 여러 대상 허용 여부를 선언한다. `bindings`는 그 역할에 맵 오브젝트 ID 배열을 연결한다. 없는 대상·지원하지 않는 기능·잘못된 개수는 실행 전에 거부한다. 의자 하나의 `seat` 명령에는 정확히 한 대상을 연결한다. 의자의 착석 위치는 오브젝트의 `seatOffset`, 방향은 `rotation`으로 지정한다. 위치와 크기는 m, 회전은 라디안이다.

같은 오브젝트의 이동·텍스트·착석을 서로 다른 시스템이 동시에 제어하려 하면 맵 검증에서 거부한다. 같은 오브젝트에 상호작용 시스템과 착석 시스템을 함께 연결하는 것은 허용한다. 사용자 한 명이 두 자리에 동시에 앉거나 한 자리를 두 사람이 차지하는 요청은 서버가 거부한다.

## 이벤트와 현재 상태

입력·출력은 이름과 payload 자료형을 선언한다. 지원 자료형은 `number`, `string`, `boolean`, `user`, `object`다. 사용자·오브젝트 참조는 실제 접속자와 현재 맵의 대상인지 서버에서 확인한다. 클릭한 사용자는 클라이언트가 payload에 임의로 적는 대신 기존 연결의 실행 문맥인 `{ "actor": true }`로 전달한다.

출력의 값을 입력으로 옮길 때 기본값은 같은 필드 이름이다. 다른 이름을 연결하려면 `mapping`에 **입력 필드: 출력 필드**를 작성한다. 자료형이 다른 연결과 동일한 연결의 중복은 거부한다. 대상 입력이 payload를 요구하지 않으면 버튼의 사용자 정보 같은 부가 출력은 버릴 수 있다.

```ts
.connect({
  from: 'chair-button', output: 'pressed',
  to: 'chair-controller', input: 'sit',
  mapping: { user: 'user' },
})
```

`pressed`·`finished`는 순간의 이벤트다. 타이머의 `remaining`·`running`과 착석자는 현재 상태이며, 늦게 들어온 사용자에게도 snapshot으로 전달한다. 서버는 입력 명령의 ID·revision을 확인하고 처리 전체를 저장한 뒤 확정 상태를 배송한다. 같은 명령의 재전송, 저장 실패, 이벤트 연결 순환이 부분 실행으로 남지 않게 한다.

현재 새 시스템의 상태는 방 참가자에게 공유되는 상태다. 참가자 전용·서버 전용 비공개 상태를 새 시스템의 state에 넣지 않는다. 기존 shared-assets의 참가자별 필터링 경로는 별도로 유지한다.

## 실행 API와 수명주기

현재 실행기는 JSON 선언의 `set`, `emit`, `if`, `move`, `text`, `schedule`, `cancel`, `seat`, `unseat`를 공통으로 처리한다. 값은 상태·설정·이벤트·사용자·서버 시각과 제한된 계산식으로 표현한다. JavaScript·Wasm·임의 모듈을 업로드해 실행하는 기능이나 외부 파일을 자동 import하는 기능은 제공하지 않는다. 새 기능은 이 명령 범위에서 선언하고, 새 종류의 동작이 필요하면 SDK 자체를 확장한다.

`$mount`는 새 시스템 배치의 초기화, `$dispose`는 배치 제거, `$leave`는 사용자 퇴장 시 호출한다. 일반 입력으로 이 이름을 호출할 수 없다. `$leave`에서는 `{ "actor": true }`가 퇴장한 사용자를 뜻한다. 새 시스템 버전으로 갱신할 때 `$mount`를 다시 실행해 상태를 초기화하지 않는다.

시스템 제거 시 예약 작업도 제거하고, 사용자 퇴장 시 착석 점유와 사용자 참조를 가진 예약을 정리한다. 방 실행기의 메모리를 해제해도 저장된 실행 상태는 유지되며, 다시 열면 저장된 상태와 서버 기준 시간을 이어받는다. 세션 자체의 삭제·영속 데이터 삭제는 별도 보존 정책에 따른다.

| 실행 한도 | 현재 값 |
| --- | --- |
| 맵 오브젝트·시스템 배치 | 각각 128 |
| 맵 연결 | 256 |
| manifest의 중첩 명령·계산식 깊이 | 각각 8 |
| manifest 전체 명령 | 256 |
| 한 처리의 명령·계산 단계 / 이벤트 | 4096 / 64 |
| 저장된 예약 작업 | 256 |
| 방 실행 상태 | 512 KiB |
| 시스템 입력 | 사용자·방별 초당 20회 |

타이머는 서버의 종료 시각을 기준으로 계산한다. 남은 시간을 소수 초까지 보존하고 표시할 때만 반올림하므로 일시정지·재시작으로 시간이 늘어나지 않는다. `duration` 단위는 초, `schedule.delayMs`는 ms다. 타이머 예제의 `pause`는 남은 시간을 유지하고 `reset`은 설정한 전체 시간으로 돌아간다. 서버의 예약 처리는 주기적으로 실행되므로 완료 이벤트는 정확한 실시간 마감 보장을 의미하지 않는다.

## 버전이 바뀌어도 오브젝트 유지

맵 제작자는 `systemId`만 지정한다. 중앙에는 공개한 각 버전의 원본을 보존하고, 실행기는 자신이 사용 중인 정확한 원본과 상태를 내부적으로 기록한다. 이는 작성자가 모든 맵의 버전을 수동으로 고정하는 방식이 아니다.

호환되는 최신 버전이 배포되면 실행기는 기존 `instanceId`, 바인딩, 설정, 현재 상태, 움직인 오브젝트 위치, 착석과 진행 중 예약을 유지해 갱신한다. 새 상태·설정에는 새 기본값을 채운다. 기존 입력·출력 payload, 대상 규격, 상태·설정 자료형이 호환되지 않으면 기존 버전으로 계속 작동하고 `diagnostics`에 이유를 남긴다. 호환되지 않는 업데이트 때문에 오브젝트를 삭제하거나 새 ID로 교체하지 않는다.

상태 이름을 바꿀 때는 새 manifest에 변환 규칙을 선언한다. 현재는 이름 이전을 지원한다. 복잡한 임의 변환 프로그램이나 입력·출력 이름의 자동 변경은 지원하지 않는다.

```json
"migrations": [
  { "from": "1.0.0", "renameState": { "remaining": "remaining-seconds" } }
]
```

이전 값을 새 범위에 넣을 수 없거나 연결·예약을 유지할 수 없으면 이전 상태를 보존한다. 공개한 같은 ID·버전의 bytes는 덮어쓰지 않고 새 버전으로 제출한다. 운영 서버에서 이전 원본을 삭제하면 이 복구가 불가능하므로 영속 볼륨을 유지하고 원본과 방 상태를 함께 백업한다.

자동 호환성 검사는 연결·자료형·범위·상태 이전을 검사한다. 작성자가 바꾼 로직의 모든 의미가 이전과 같음을 증명하는 기능은 아니므로, 새 버전 제출 시 실제 입력 시나리오와 예상 결과를 확인해야 한다.

## 기존 클라이언트 오브젝트 연결

`SystemObject`에 기존 맵 모델을 넣고 안정적인 오브젝트 ID를 지정하면 이동·회전·텍스트·상호작용을 연결한다. 기본 `SystemObjects3D`는 이 연결 코드를 사용해 맵 소유의 버튼·의자·표시판 예제를 그린다. 중앙 패키지가 모델을 제공하는 것은 아니다. 같은 ID의 모델을 중복 생성하지 않도록 해당 맵의 렌더러를 구성한다. [모델 연결과 로컬 시험](shared-systems-playtest.md)에 실행 예제가 있다.

기존 3D 상호작용 경로는 오브젝트의 `userData.use`를 호출할 수 있다. 기존 mesh/group에 다음 방식으로 입력을 연결한다. 포인터 클릭을 직접 쓰는 경우에도 같은 함수를 호출할 수 있다.

```tsx
import { interactSystemObject } from '../systems/api.ts';

<group userData={{
  hint: '타이머 시작',
  use: () => interactSystemObject('start-switch'),
}}>
  {/* 맵이 이미 사용 중인 모델 */}
</group>
```

버튼 외의 입력은 `inputSystem(instanceId, input, payload)`로 요청한다. 사용자 선택 코드가 의자에 다른 접속자를 전달할 수도 있다. 서버 착석 상태로 캐릭터 전체 위치와 다리 각도만 조절하고 기존 모델의 비율을 반영한다. 손·머리·상체 동작과 사용자 시선·기울기는 기존 경로를 유지한다. 임의 GLB의 리깅 자동 해석이나 모든 VR 장치의 입력 검증을 완료했다고 간주하지 않는다.

일반 클라이언트는 공유 시스템 입력을 최대 128개까지 순서대로 보낸다. 서버는 각 명령 ID에 `applied`·`duplicate`·`rejected` 결과를 연결해 응답한다. 타이머 갱신 등으로 해당 명령이 실행되기 전에 revision 충돌이 발생한 경우에만 최신 revision으로 최대 8회 재시도한다. 이미 실행한 명령이나 결과를 알 수 없는 입력은 다시 보내지 않는다. 15초 동안 응답이 없으면 오류를 알리고 대기 입력을 비운다. 방·맵 변경, 연결 끊김, 전체 snapshot 복원 시에도 이전 대기 입력을 지워 다른 방이나 복구된 상태에 뒤늦게 적용되지 않게 한다.

늦게 들어오거나 데이터를 재연결한 사용자는 시스템 상태·대상·연결·착석 정보와 실제 아이템을 같은 전체 snapshot으로 복구한다. 재생을 처음부터 시작하지 않고 현재 타이머 상태와 메모 표시를 받는다. 이 경로의 실제 서버 통신 시험은 [로컬 동작 시험](shared-systems-playtest.md#실제-서버-통신-자동-시험)에 있다.

## 등록과 확인

새 시스템 양식 생성, PR 검사, Docker의 중앙 반영, 수동 publish와 복구는 [공유 시스템 등록 안내](shared-systems-registration.md)를 따른다. 홈과 게임 내부 메뉴에서 **아이템** 바로 아래의 **공유 시스템**을 연다. 독립 시험 화면에서는 **등록된 공유 시스템 보기**를 누른다. 목록 위의 **공유 시스템 사용법**과 **새 시스템 등록 가이드**는 처음에는 접혀 있으며, 제목을 눌러 화면 안에서 읽고 다시 접을 수 있다. 사용법에는 맵 작성·대상 연결·이벤트 예제가, 등록 가이드에는 양식 생성·검사·PR 제출·중앙 반영 절차가 있다.

목록에서 중앙에 등록된 시스템을 검색하고, 설명·연결 대상·설정·상태·입출력·공개 버전·원본·코드 작성 예제를 확인할 수 있다. 새 시스템을 추가한 뒤에는 목록을 새로 불러와 확인한다. 이 목록은 읽기 전용이며 맵 편집기나 관리자 승인 화면은 제공하지 않는다.

서버의 `GET /api/shared-systems`는 같은 카탈로그를 JSON으로 반환한다. 각 항목의 `integrity`에 대응하는 `GET /system-originals/<integrity>`에서 공개된 정확한 원본을 확인할 수 있다. 목록의 버전 정보는 조회용이고, 맵 코드에는 계속 `systemId`만 작성한다.

`npm run test:systems`로 대상·연결 계약, 상태 이전, 실행 예산, 저장 실패, 타이머, 착석, 원본 등록을 확인한다. 테스트 통과와 실제 운영 서버 배포 성공은 구분해서 보고한다.
