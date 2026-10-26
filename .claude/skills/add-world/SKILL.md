---
name: add-world
description: Tonarium に新しいワールド（セッションが読み込む 3D 空間の種類。現行はホール・カフェ・ゲーム・サバイバーズ・街・ガーデン・星あかりのラウンジ・AD 研究所の8種）を追加する、または既存ワールドの家具や見た目を変えるときの手順と、触るファイルの一覧。共有システムをコードで配置・接続する例も含む。
---

# ワールドを追加する

先に CLAUDE.md のルールに従う（特に、仕様が曖昧なら実装前に質問する）。よく聞くこと：どんな場所か、家具に当たり判定を付けるか、どのセッションの最初のワールドにするか。

用語：セッション（`sessions.json` の 1 件。通話・チャット・アイテムを持つ）が、ワールド（3D 空間の種類）を 1 つ読み込む。ワールドは設定メニューから誰でも切り替えられる。

## 部屋の決まった形

- 床は x, z とも -10〜10（`ROOM_HALF`）、壁の高さ 4m。ふつうは形を変えず、色と中身だけ変える（`Shell` が床と壁を描く）
- 階や高い所があるワールド（街のマンションや駅など）は、当たり判定に `y0`〜`y1`（その高さの間だけ効く）を付け、歩ける面（床・坂）と動く物（電車・エレベーター）は `shared/city.ts` と `client/src/view3d/cityPhysics.ts` のやり方に倣う
- 部屋の外にも行ける場所が要るとき（ゲームワールドの塔など）は、`WORLDS` の `extent` で 3D の人がいられる範囲を広げ、床と壁は自前で描く（`game3d.tsx` の `GameWorld` を参照）。部屋の外での移動・高さ・落下は `client/src/view3d/Player.tsx` の `groundAt` と `clampTo` に足す
- 南寄りの丸いスポーンエリア（`shared/protocol.ts` の `SPAWN`：中心 (0, 6.5)、半径 1.6）には家具を置かない。入ってきた人と 2D の人がここに立つ
- yaw 0 は -Z（北）向き

## 触るファイル

1. `shared/worlds.ts`（必須）
   - `WorldKind` に種類を足し、`WORLDS` に名前・説明（設定メニューに出る）・`solids`（通り抜けられない物）を足す
   - `solids` は円 `{ x, z, r }` か箱 `{ x, z, w, d }`（x, z が中心）。3D の人・2D の人・アイテムがここから押し出される
   - 家具の配置は `CAFE` のように定数にまとめ、見た目と当たり判定の両方から使う（ずれないように）
2. `client/src/view3d/worlds3d.tsx`（必須）
   - `PALETTES` に床・壁・スポーンエリアの色、`WORLD_BG` に背景色を足す
   - 家具などの中身をコンポーネントで書き（`Cafe` を参考に、`Box`・`Cyl` を使う）、`WorldMesh` の分岐に足す。床と壁は `Shell` が描く
   - 光源もワールドごとに置く（`Hall` と `Cafe` の先頭を参照）。照準の当たり判定が要らない飾りは `userData={{ noRay: true }}`
3. `client/src/home/SessionCard.tsx` と `client/src/home/pages.tsx`（必須）
   - `WORLD_TINT`（SessionCard）と `WORLD_FACE`（pages）はどちらも `Record<WorldKind, string>` で、足さないと型チェックが落ちる
   - `Home.tsx` と `messages.tsx` にも同名の色テーブルがあるが、そちらは `Record<string>` で型上は必須ではない（見た目を揃えるなら任意で足す）
4. `sessions.json`：あるセッションの最初のワールドにするなら `"world": "<種類>"`
5. ドキュメント：`docs/3d.md` の「ワールド」の節と、README の「セッション構成の変更」の `world` の候補を更新する

## 공유 시스템을 붙여서 맵 만들기

월드의 외형은 위 절차로 만들고, 그 안에서 동작할 오브젝트·시스템·연결은 아래 순서로 추가합니다. 버튼·타이머·의자처럼 중앙에 등록된 기능을 먼저 찾아 재사용하세요.

현재는 맵 편집기나 커스텀 코드 맵을 불러오는 인게임 메뉴가 없습니다. **공유 시스템 목록은 ID·설명·연결 예제를 확인하는 곳**입니다. 아래 맵 파일을 서버에 등록하고, 자신의 월드·세션 진입 코드에서 불러와야 실제로 배치됩니다. 아이템 메뉴에서 메모나 체스판을 꺼내는 것만으로 공유 시스템이 자동으로 붙지는 않습니다.

### 1. 필요한 ID부터 확인하기

| 코드의 키 | 아래 예제 | 의미 |
|---|---|---|
| `itemId` | `note` | 기존 아이템의 종류 ID. 이 예제에서는 메모 모델을 재사용합니다. |
| `systemId` | `button`, `timer`, `chair` | 중앙에 등록된 동작 시스템 ID. 새로 이름을 지어 쓰지 않습니다. |
| 오브젝트의 `id` | `start-switch`, `clock-note` | 이 맵에서 제작자가 정하는 배치 ID. `bindings`에서 이 이름을 연결합니다. |
| `instanceId` | `start-button`, `countdown` | 이 맵에 배치한 시스템 하나의 ID. 같은 `systemId`를 여러 번 써도 각각 다르게 지정합니다. |

ID는 연결에 사용하는 값이므로 번역하거나 실행 중에 바꾸지 않습니다. `pressed`, `start`, `sit` 같은 입출력 이름도 해당 시스템의 계약대로 씁니다.

자세한 항목은 [공유 시스템 시작 안내](../../../docs/shared-systems/README.md), [메모 아이템](../../../docs/shared-systems/items/note.md), [버튼](../../../docs/shared-systems/systems/button.md), [타이머](../../../docs/shared-systems/systems/timer.md), [의자](../../../docs/shared-systems/systems/chair.md)를 참고하세요.

### 2. 버튼을 누르면 30.5초 타이머가 시작되는 맵 만들기

**`shared/my-shared-map.ts`**를 만들고 아래 내용을 넣습니다. `shared/`는 Docker 배포에도 포함되는 위치입니다. 버튼은 기본 오브젝트로, 시간 표시는 기존 메모 아이템으로 배치합니다.

```ts
import { createSystemMap } from './system-map.ts';

export const myMap = createSystemMap('my-map')
  .object({
    id: 'start-switch',
    capabilities: ['interact'],
    position: [-2, 0.7, -2],
    size: [0.5, 0.3, 0.5],
    color: '#49ad75',
  })
  .item({
    id: 'clock-note',
    itemId: 'note',
    itemMode: 'system',
    capabilities: ['text'],
    position: [0, 0, -2],
    text: '00:30.5',
  })
  .system({
    instanceId: 'start-button',
    systemId: 'button',
    bindings: { target: ['start-switch'] },
    config: {},
  })
  .system({
    instanceId: 'countdown',
    systemId: 'timer',
    bindings: { display: ['clock-note'] },
    config: { duration: 30.5 },
  })
  .connect({
    from: 'start-button',
    output: 'pressed',
    to: 'countdown',
    input: 'start',
  })
  .build();
```

`bindings.target`은 누를 오브젝트, `bindings.display`는 시간을 표시할 오브젝트입니다. `.connect()`는 시작 버튼의 `pressed` 출력을 타이머의 `start` 입력으로 보냅니다. `duration`의 단위는 초이고 `30.5`처럼 소수를 사용할 수 있습니다. 기본 아이템의 `.item()` 배치 높이는 `position`의 두 번째 값인 `0`을 유지합니다.

처음에는 아래 값만 바꿔 보세요.

| 바꾸고 싶은 것 | 수정할 값 |
|---|---|
| 타이머 길이 | `config: { duration: 30.5 }`의 숫자. 단위는 초입니다. |
| 버튼 위치·모양 | `start-switch`의 `position`, `size`, `color` |
| 시간 표시 위치 | `clock-note`의 `position`. 아이템의 높이는 `0`으로 둡니다. |
| 시작 대신 정지·초기화 | 연결의 `input: 'start'`를 `'pause'` 또는 `'reset'`으로 변경합니다. 별도 버튼도 같은 방식으로 추가합니다. |
| 연결할 오브젝트 | 시스템의 `bindings` 배열 안 배치 ID. 해당 오브젝트의 `id`와 같아야 합니다. |

### 3. 서버가 선택할 수 있도록 맵 등록하기

`server/system-maps.ts`의 상단 import에 다음 줄을 추가합니다.

```ts
import { myMap } from '../shared/my-shared-map.ts';
```

기존 `systemMaps` 선언 아래에 다음 줄을 추가합니다. 다른 맵의 등록은 남겨 둡니다.

```ts
systemMaps.set(myMap.id, myMap);
```

파일 저장 후 서버를 재시작하거나 개발 서버가 변경을 반영했는지 확인합니다. 등록되지 않은 ID를 불러오면 `Unknown registered code map` 오류가 납니다.

### 4. 자신의 월드 진입 코드에 불러오기 연결하기

`client/src/my-map-entry.ts`를 만들면 다음과 같이 접속 상태를 확인하는 호출을 준비할 수 있습니다.

```ts
import { get } from './store.ts';
import { loadSystemMap } from './systems/api.ts';

export function loadMyMapForCurrentSession() {
  const state = get();
  if (!state.session || state.sync !== 'connected') return false;
  loadSystemMap('my-map');
  return true;
}
```

**함수를 선언하는 것만으로는 실행되지 않습니다.** 자신이 만든 월드·세션 진입 처리에서 동기화가 연결된 뒤 `loadMyMapForCurrentSession()`을 한 번 호출해야 합니다. 이 함수의 `true`는 요청을 보냈다는 뜻이며, 실제 배치는 서버의 상태 응답으로 확인합니다.

React 월드 컴포넌트에서 연결하려면 같은 파일에 아래 코드를 더할 수 있습니다. `useMyMapOnEntry()`는 이 맵을 사용할 **자신의 월드 컴포넌트 안에서만** 호출합니다.

```ts
import { useEffect, useRef } from 'react';
import { useStore } from './store.ts';

export function useMyMapOnEntry() {
  const session = useStore(state => state.session);
  const sync = useStore(state => state.sync);
  const loadedSession = useRef<string | null>(null);

  useEffect(() => {
    if (!session || loadedSession.current === session) return;
    if (loadMyMapForCurrentSession()) loadedSession.current = session;
  }, [session, sync]);
}
```

매 프레임이나 렌더 함수 본문에서 `loadSystemMap()`을 호출하지 않습니다. 모든 월드에 공통인 진입 코드에 무조건 연결하면 다른 맵도 덮어쓰므로, 원하는 월드·세션에서만 실행되도록 범위를 정합니다. 공유 시스템 배치는 세션에 저장되며 3D 월드 종류를 바꾸는 것만으로 자동 제거되지 않습니다.

### 5. 같은 맵에 의자 동작 추가하기

2번 코드의 마지막 `.build()` **앞에** 다음 체인을 넣습니다. 이 예제는 좌석 오브젝트를 누른 참가자가 앉도록 버튼과 의자를 연결합니다.

```ts
  .object({
    id: 'seat-target',
    capabilities: ['interact', 'seat'],
    position: [-3, 0.4, -1],
    size: [0.7, 0.8, 0.7],
    rotation: Math.PI,
    seatOffset: [0, 0.4, 0],
  })
  .system({
    instanceId: 'seat-click',
    systemId: 'button',
    bindings: { target: ['seat-target'] },
    config: {},
  })
  .system({
    instanceId: 'my-seat',
    systemId: 'chair',
    bindings: { seat: ['seat-target'] },
    config: {},
  })
  .connect({
    from: 'seat-click',
    output: 'pressed',
    to: 'my-seat',
    input: 'sit',
    mapping: { user: 'user' },
  })
```

`pressed`가 보낸 참가자의 `user`를 `sit`에 전달합니다. 다른 이벤트 시스템을 연결할 때도 앉힐 참가자의 `user`를 전달해야 합니다. 현재 사용자 자신의 착석은 스페이스바로 해제할 수 있습니다.

`chair`는 착석 동작을 제공하며 의자 모델을 포함하지 않습니다. 위 `.object()`는 기본 오브젝트로 보입니다. 의자 외형·재질·별도 애니메이션은 월드 코드에서 제작하고, 그 모델이 사용할 대상·위치·착석 기준점을 연결합니다. 버튼과 타이머도 동작 시스템이며 원하는 외형을 제작자가 선택합니다.

### 6. 배치 모드와 확인할 동작

- `itemMode: 'native'` 또는 생략: 기존 아이템의 게임·편집·운반·회수 동작을 사용합니다. 공유 시스템의 연결 대상으로 쓰지 않습니다.
- `itemMode: 'system'`: 기존 아이템 모델을 공유 시스템의 대상으로 씁니다. 원래 아이템의 조작·운반·개별 삭제는 차단되며 연결한 시스템이 동작을 결정합니다. `text` 표시 기능은 현재 `note`만 지원합니다.
- 현재 공유 시스템 배치를 개별 삭제하는 인게임 기능은 없습니다. 배치를 수정하려면 코드 맵에서 관련 오브젝트·시스템·연결을 함께 수정한 뒤 등록된 맵을 다시 불러옵니다. 중앙 시스템 원본을 삭제하지 않습니다.
- 두 사용자로 접속해 버튼·시간 표시·착석을 확인하고, 늦게 들어온 사용자도 서버에서 확정된 현재 상태를 받는지 확인합니다. 과거 이벤트를 처음부터 다시 실행하는 방식이 아닙니다.
- `.system()`에는 버전이나 해시를 고정하지 않습니다. 배치 ID·연결·호환되는 설정과 상태를 유지하면서 적용 가능한 새 버전을 사용하고, 호환되지 않으면 이전 원본을 유지합니다.
- `npm run dev:systems`의 독립 시험 화면은 기본 `system-demo`를 실행합니다. 위에서 만든 `my-map`을 자동으로 읽는 시험기는 아닙니다. 커스텀 맵은 일반 Tonarium에서 3~4번 등록·호출을 연결해 확인합니다.

새 시스템 자체를 중앙에 제출하는 순서는 [중앙 시스템 등록 안내](../../../docs/shared-systems/registration.md)를 따릅니다. 맵에서 기존 시스템을 사용하는 작업과 새 중앙 시스템을 업로드하는 작업을 구분합니다.

## 確認

- `changelog/YYYY-MM-DD-<識別子>.json` を新規追加し（共通履歴 `shared/changelog.ts` への手動追記は不要。形式は `docs/changelog.md` を参照）、`npm run check:completion`（履歴チェック・型チェック・ビルド）を通す。失敗したら完了にしない
- 見た目はブラウザで確かめる効果が高い。`npm run dev`（`.claude/launch.json` の `dev`）で入って 3D にし、`window.__t3d.pos(x, z)` と `look(yaw, pitch)` で見たい所へ動かして撮る。前面のパネルは `document.querySelectorAll('.panel, .worldbadge').forEach((e) => (e.style.visibility = 'hidden'))` で隠せる
- 当たり判定は `pos` で家具の中に入れてから `state().selfAvatar` を読み、外へ出されているかを見る
- ワールドの切り替えは設定メニューの「ワールド」から（全員に反映され、ログに出る）
