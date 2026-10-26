import { useState } from 'react';
import { systemItemDefinitions } from '../../../shared/system-items.ts';
import { ITEM_INFO } from '../i18n/static.ts';

export function SystemItemCatalog() {
  const [search, setSearch] = useState('');
  const entries = systemItemDefinitions().filter(entry => `${entry.id} ${entry.info.name} ${ITEM_INFO[entry.kind].name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <details className="system-catalog-item"><summary><strong>기존 아이템을 ID로 배치하기</strong></summary><div className="system-catalog-detail">
    <p>기본 아이템의 외형과 기능을 맵 코드에서 재사용할 수 있습니다. <code>itemId</code>는 아이템 종류이고 <code>id</code>는 맵 안의 고유 배치 이름입니다.</p>
    <label className="system-catalog-search">아이템 ID 검색<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="note, chess, jumpPad…" /></label>
    <div className="system-catalog-table"><table><thead><tr><th>아이템 ID</th><th>이름</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><code>{entry.id}</code></td><td>{ITEM_INFO[entry.kind].name}</td></tr>)}</tbody></table></div>{!entries.length && <p>검색 결과가 없습니다.</p>}
    <h3>기존 기능으로 배치</h3><pre>{`.item({\n  id: 'lobby-chess', itemId: 'chess',\n  position: [2, 0, -3], rotation: 0,\n})`}</pre>
    <h3>타이머 표시판으로 연결</h3><pre>{`.item({\n  id: 'clock-note', itemId: 'note', itemMode: 'system',\n  capabilities: ['text'], position: [0, 0, -2],\n})\n.system({\n  instanceId: 'clock', systemId: 'timer',\n  bindings: { display: ['clock-note'] }, config: { duration: 30 },\n})`}</pre>
    <p><code>createSystemMap(...)</code> 체인에 넣는 예제입니다. 기본 배치는 기존 기능을 사용합니다. <code>itemMode: 'system'</code>에서는 공유 시스템이 동작을 제어하고 원래 아이템의 조작·운반·수거는 막습니다. 글 표시 대상은 메모 종류만 지원합니다. 현재 아이템 배치 높이는 바닥인 <code>0</code>입니다.</p><p>이미지·영상·YouTube는 미디어 초기값이 필요하므로 이 ID 목록에 포함하지 않습니다.</p>
  </div></details>;
}
