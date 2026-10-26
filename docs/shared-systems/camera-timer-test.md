# 기존 카메라로 5초 뒤 촬영하기

기존 카메라 모델과 촬영 기능에 중앙의 `timer`를 연결한 시험 예제입니다. 화면에는 **카메라 하나만** 배치됩니다. 남은 초는 카메라 바로 위에 표시하며, 카메라를 작동시킨 탭에서 5·4·3·2·1에 짧은 소리가 난 뒤 기존 셔터음과 함께 한 번 촬영합니다. 사진은 기존 카메라와 동일하게 세션 채팅에 올라옵니다.

## 로컬에서 사용하기

1. 일반 Tonarium 개발 서버를 `npm run dev`로 실행합니다. 독립 `dev:systems` 화면은 사용하지 않습니다.
2. 로컬 웹 주소에 `?cameraTimerTest=1`을 붙여 엽니다. 기본 주소는 `http://localhost:5173/?cameraTimerTest=1`이며 포트를 바꿨다면 해당 포트를 사용합니다.
3. 이름을 입력하고 원하는 세션에 **3D 모드**로 들어갑니다. 연결된 후 시험용 코드 맵이 한 번 불러와집니다.
4. 카메라를 클릭하거나 아이템 목록에서 카메라를 열어 **공유 시스템 실행**을 누릅니다. 카메라는 들지 않고 세워 둔 방향으로 촬영합니다.
5. 카메라 위의 남은 초와 효과음을 확인합니다. 5초 뒤 채팅에 올라온 사진을 누르면 확대하거나 저장할 수 있습니다.

카운트다운 소리와 셔터음은 촬영을 시작한 탭에서 납니다. 효과음 음량 설정을 따릅니다. 소리가 꺼져 있거나 브라우저가 소리를 허용하지 않아도 타이머와 촬영은 동작합니다. 카메라를 다른 방향으로 돌리려면 아래 코드의 `rotation`을 바꿉니다.

`cameraTimerTest=1`의 자동 배치는 로컬 개발 모드에서만 작동합니다. 일반 게임에 새 메뉴나 테스트 버튼은 추가하지 않습니다. 같은 세션의 기존 공유 시스템 맵을 이 시험 맵으로 교체하므로 분리된 로컬 데이터·세션에서 확인합니다. 사용자가 별도로 꺼낸 일반 아이템은 유지합니다.

## 실제 타이머 연결 코드

전체 맵 정의는 [shared/camera-timer-demo.ts](../../shared/camera-timer-demo.ts)에 있습니다.

```ts
import { createSystemMap } from './system-map.ts';

export const cameraTimerDemoMap = createSystemMap('camera-timer-demo')
  .item({
    id: 'delayed-camera', itemId: 'camera', itemMode: 'system',
    capabilities: ['interact'], position: [0, 0, -2], rotation: Math.PI,
  })
  .system({
    instanceId: 'camera-shot', systemId: 'camera-trigger',
    bindings: { camera: ['delayed-camera'] }, config: {},
  })
  .system({
    instanceId: 'camera-delay', systemId: 'timer',
    bindings: {}, config: { duration: 5 },
  })
  .connect({ from: 'camera-shot', output: 'reset', to: 'camera-delay', input: 'reset' })
  .connect({ from: 'camera-shot', output: 'start', to: 'camera-delay', input: 'start' })
  .connect({ from: 'camera-delay', output: 'finished', to: 'camera-shot', input: 'complete' })
  .build();
```

`timer`는 모델이 없는 동작 시스템입니다. `duration: 5`는 5초이며, `bindings: {}`이므로 별도 표시 오브젝트를 만들지 않습니다. 카메라 위의 숫자는 같은 타이머의 `remaining` 상태를 기존 라벨로 그립니다.

작은 [camera-trigger 원본](../../shared-systems/camera-trigger/1.0.0/system.json)은 클릭한 탭의 고유 요청과 촬영자를 기록하고 `reset`·`start`를 순서대로 보냅니다. 타이머가 내보낸 `finished`는 `complete`로 연결됩니다. 기존 SDK의 선언 명령만 사용하며 기존 `timer`의 공개 원본은 수정하지 않습니다.

클라이언트의 [연결 코드](../../client/src/systems/useCameraTimerDemo.ts)는 카메라 상호작용에 고유 `token`을 붙여 `request` 입력을 보내고, 그 요청의 완료가 확인되면 기존 `takePhoto()`를 호출합니다. `timer` 자체가 브라우저의 촬영 함수를 실행하는 것은 아니므로 이 연결 코드가 필요합니다.

## 삭제와 재시험

카메라 창의 휴지통이나 아이템 동작 메뉴의 **넣기**를 사용합니다. 3D에서 카메라를 조준한 상태의 기존 삭제 단축키도 사용할 수 있습니다. 이 시험 카메라에 한해 삭제를 허용하며, 삭제하면 그 카메라의 연결 시스템과 예약 작업도 함께 제거되어 대기 중인 촬영이 취소됩니다. 다른 일반 아이템이나 중앙 원본을 지우지 않습니다.

삭제 직후에는 자동으로 다시 생성하지 않습니다. 다시 시험하려면 위 개발용 주소를 새로 열거나 새로고침하고 세션에 재입장해 시험 맵을 다시 불러옵니다. 동작 중 연속 클릭은 무시하며, 다른 탭·늦은 입장·재접속으로 이전 촬영을 재실행하지 않습니다. 촬영 중 2D 전환·퇴장·연결 해제 시 해당 탭은 촬영 대기를 취소합니다.

```sh
npm run test:camera-timer
npm run docs:shared-systems
npm run check:shared-systems-docs
```

[카탈로그](README.md) · [일반 로컬 시험](playtest.md)
