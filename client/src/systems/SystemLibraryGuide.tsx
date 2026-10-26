const timerExample = `import { createSystemMap } from './shared/system-map.ts';

export const myMap = createSystemMap('my-map')
  .object({
    id: 'start-switch', capabilities: ['interact'],
    position: [-2, 0, -2],
  })
  .item({
    id: 'clock-note', itemId: 'note', itemMode: 'system',
    capabilities: ['text'], position: [0, 0, -2],
  })
  .system({
    instanceId: 'start-button', systemId: 'button',
    bindings: { target: ['start-switch'] }, config: {},
  })
  .system({
    instanceId: 'countdown', systemId: 'timer',
    bindings: { display: ['clock-note'] }, config: { duration: 30 },
  })
  .connect({
    from: 'start-button', output: 'pressed',
    to: 'countdown', input: 'start',
  })
  .build();`;

export function SystemLibraryGuide() {
  return <section className="system-catalog-help" aria-label="공유 시스템 안내">
    <details className="system-catalog-item"><summary><strong>공유 시스템 사용법</strong></summary><div className="system-catalog-detail">
      <p>공유 시스템은 맵의 오브젝트에 연결해서 쓰는 동작입니다. 버튼·타이머·의자 시스템을 조합하고, 오브젝트의 외형과 위치는 맵 코드에서 정합니다.</p>
      <ol>
        <li>아래 목록에서 시스템을 검색하고 펼쳐서 설명, 연결할 대상, 설정과 입력·출력 이벤트를 확인합니다.</li>
        <li>맵에 오브젝트를 만들거나 <code>.item(...)</code>으로 기본 아이템을 배치합니다. 배치마다 고유한 <code>id</code>를 정합니다.</li>
        <li><code>.system(...)</code>의 <code>systemId</code>에 중앙 시스템 ID를 넣고, <code>instanceId</code>에는 이번 배치의 고유 이름을 정합니다.</li>
        <li><code>bindings</code>에 대상 역할과 오브젝트 ID 배열을 연결합니다. 버튼의 역할은 <code>target</code>, 타이머 표시는 <code>display</code>, 의자는 <code>seat</code>입니다.</li>
        <li><code>.connect(...)</code>로 한 시스템의 출력 이벤트를 다른 시스템의 입력에 연결합니다. 예를 들어 버튼의 <code>pressed</code>를 타이머의 <code>start</code>에 연결합니다.</li>
        <li>맵을 서버의 맵 목록에 등록하고 불러옵니다. 목록의 <strong>연결 예제 복사</strong>도 맵 작성에 사용할 수 있습니다.</li>
      </ol>
      <h3>버튼으로 30초 타이머 시작하기</h3>
      <p>다음 예제를 저장소 루트의 <code>my-map.ts</code>로 저장합니다. 버튼을 누르면 기본 메모 아이템에 남은 시간이 표시됩니다.</p>
      <pre>{timerExample}</pre>
      <p><code>server/system-maps.ts</code>에서 맵을 가져와 기존 <code>systemMaps</code>에 등록합니다.</p>
      <pre>{`import { myMap } from '../my-map.ts';

systemMaps.set(myMap.id, myMap);`}</pre>
      <p>일반 게임의 클라이언트 코드에서는 <code>client/src/systems/api.ts</code>의 <code>loadSystemMap('my-map')</code>을 호출합니다. 기본 예제는 방에 입장한 뒤 게임 화면 오른쪽 위 <strong>공유 시스템 → 버튼·타이머·의자 코드 예제 실행</strong>으로 바로 확인할 수 있습니다.</p>
      <h3>타이머·의자와 기존 아이템 연결</h3>
      <ul>
        <li>타이머의 <code>duration</code>은 초 단위입니다. <code>pause</code>는 남은 시간을 유지하고 <code>reset</code>은 전체 시간으로 되돌립니다. <code>00:00</code> 이후 새로 시작하려면 초기화합니다. 타이머 하나의 <code>display</code>에는 표시 오브젝트 하나를 연결합니다.</li>
        <li>의자는 버튼과 같은 상호작용 시스템의 <code>pressed</code> 출력을 <code>sit</code> 입력에 연결하고 <code>{`mapping: { user: 'user' }`}</code>로 누른 사용자를 전달합니다. <code>stand</code> 입력으로 일어서게 할 수 있고, 앉은 본인은 스페이스바로 일어납니다.</li>
        <li>기본 아이템은 <code>itemId</code>로 고릅니다. 원래 기능으로 쓰려면 <code>.item(...)</code>으로 배치하고, 공유 시스템의 대상으로 쓰려면 <code>itemMode: 'system'</code>과 필요한 <code>capabilities</code>를 지정합니다. 시스템 모드에서는 원래 조작·운반·수거를 막습니다.</li>
        <li>기본 아이템의 배치 높이는 <code>0</code>이며, 글 표시 대상은 메모입니다. 아래 <strong>기존 아이템을 ID로 배치하기</strong>에서 사용할 수 있는 기본 아이템을 확인합니다.</li>
      </ul>
      <p>맵에는 시스템 버전을 고정하지 않습니다. 호환되는 업데이트는 연결과 상태를 유지하고, 호환되지 않으면 기존 버전으로 계속 동작하며 진단에 이유를 표시합니다.</p>
    </div></details>
    <details className="system-catalog-item"><summary><strong>새 시스템 등록 가이드</strong></summary><div className="system-catalog-detail">
      <p>등록은 <strong>파일 작성 → 로컬 검사 → GitHub PR 제출 → 병합 → 서버 재배포 → 목록 확인</strong> 순서로 진행합니다.</p>
      <h3>1. 기본 양식 만들기</h3>
      <p>저장소와 Node 24 개발 환경을 준비한 뒤 다음 명령을 실행합니다.</p>
      <pre>{`npm ci
npm run systems -- init my-system .`}</pre>
      <p><code>shared-systems/my-system/1.0.0/system.json</code>이 만들어집니다. 중앙에 등록하는 파일에는 제한된 JSON 동작 명령을 작성합니다. JavaScript나 모델·이미지 파일을 넣지 않습니다. 새로운 종류의 명령이 필요하면 공통 실행 규격을 먼저 확장해야 합니다.</p>
      <h3>2. 기능과 연결 규칙 작성하기</h3>
      <ul>
        <li><code>schema</code>와 <code>sdk</code>: 생성된 양식의 실행 규격을 유지합니다.</li>
        <li><code>id</code>·<code>version</code>: 폴더와 같은 시스템 ID·버전을 적습니다.</li>
        <li><code>title</code>·<code>description</code>·<code>license</code>·<code>credits</code>: 이름, 기능·사용법·제약, 사용 조건과 제작자·출처를 적습니다.</li>
        <li><code>targets</code>: 연결할 대상의 역할, 필요한 기능, 필수 여부와 연결 개수를 정합니다.</li>
        <li><code>config</code>·<code>state</code>: 설정과 서버가 보존할 상태의 자료형·초기값·범위를 정합니다.</li>
        <li><code>inputs</code>·<code>outputs</code>·<code>handlers</code>: 입력·출력 데이터와 각 입력의 작동 순서를 작성합니다. 필요하면 <code>interaction</code>으로 클릭 대상을 지정합니다.</li>
      </ul>
      <p>현재 기본 예제는 <code>shared-systems/button/</code>, <code>timer/</code>, <code>chair/</code>입니다. 각 파일과 <code>shared/system-types.ts</code>의 필드·명령 형식을 참고하세요.</p>
      <h3>3. 검사하고 PR로 제출하기</h3>
      <pre>{`npm run systems -- validate .
npm run test:systems
npm run test:systems-playtest`}</pre>
      <p>시험용 맵에 연결해 여러 배치·사용자, 반복 입력, 퇴장·재접속과 상태 보존을 확인합니다. 작업 날짜의 <code>changelog/YYYY-MM-DD-my-system.json</code>에 <code>date</code>·<code>title</code>·<code>items</code>를 적은 뒤 <code>npm run check:completion</code>을 실행합니다.</p>
      <p>시스템 파일, 새 변경 이력과 필요한 시험 코드를 같은 PR로 제출합니다. 설명에는 기능, 연결 방법, 사용 조건과 수행한 검사를 적습니다.</p>
      <h3>4. 중앙에 반영하고 업데이트하기</h3>
      <p>PR이 병합된 뒤 서버를 재배포하면 검증된 파일이 중앙 저장소에 등록됩니다. 기존 영속 저장소를 유지한 상태로 배포하고, 이 화면의 <strong>목록 새로고침</strong>으로 새 ID·버전을 확인합니다. PR 생성이나 검사 통과만으로 운영 목록에 반영되지는 않습니다.</p>
      <p>공개한 버전 파일은 수정·삭제하지 않고 새 버전 폴더를 추가합니다. 기존 ID·연결 규칙·기본값을 유지하고, 상태 필드 이름을 바꾸면 <code>migrations</code>를 작성해 이전 값을 옮깁니다. 새 버전에서도 기존 맵의 동작을 시험하세요.</p>
    </div></details>
  </section>;
}
