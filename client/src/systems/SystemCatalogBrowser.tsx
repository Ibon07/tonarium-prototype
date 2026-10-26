import { useEffect, useState } from 'react';
import type { Capability, SystemCatalog, SystemEntry, SystemPort, ValueSchema } from '../../../shared/system-types.ts';
import { latestSystem } from '../../../shared/systems.ts';
import { catalogExampleCode } from './catalog-example.ts';
import './catalog.css';
import { SystemItemCatalog } from './SystemItemCatalog.tsx';
import { SystemLibraryGuide } from './SystemLibraryGuide.tsx';

const capabilities: Record<Capability, string> = { interact: '상호작용', move: '이동', text: '텍스트 표시', seat: '착석 기준점' };

function Fields({ fields }: { fields: Record<string, ValueSchema> }) {
  return Object.keys(fields).length ? <div className="system-catalog-table"><table><thead><tr><th>이름</th><th>자료형</th><th>기본값</th><th>범위</th></tr></thead><tbody>{Object.entries(fields).map(([name, field]) => <tr key={name}><td><code>{name}</code></td><td>{field.type}</td><td><code>{JSON.stringify(field.default)}</code></td><td>{field.min === undefined && field.max === undefined ? '제한 없음' : `${field.min ?? '제한 없음'} ~ ${field.max ?? '제한 없음'}`}</td></tr>)}</tbody></table></div> : <p>없음</p>;
}

function Ports({ ports }: { ports: Record<string, SystemPort> }) {
  return Object.keys(ports).length ? <dl className="system-catalog-ports">{Object.entries(ports).map(([name, port]) => <div key={name}><dt><code>{name}</code></dt><dd>{Object.entries(port.payload).map(([key, type]) => `${key}: ${type}`).join(', ') || '전달 데이터 없음'}</dd></div>)}</dl> : <p>없음</p>;
}

function CatalogItem({ entries, latest }: { entries: SystemEntry[]; latest: SystemEntry }) {
  const [version, setVersion] = useState(''), [copyMessage, setCopyMessage] = useState('');
  const entry = entries.find(item => item.version === version) ?? latest, manifest = entry.manifest;
  const code = catalogExampleCode(latest.manifest);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopyMessage('연결 예제를 복사했습니다.'); }
    catch { setCopyMessage('아래 코드를 선택해서 복사해 주세요.'); }
  };
  return <details className="system-catalog-item"><summary><span><strong>{latest.manifest.title}</strong><code>{latest.id}</code></span><span>최신 {latest.version} · {entries.length}개 버전</span></summary>
    <div className="system-catalog-detail">
      <label>공개된 버전<select value={entry.version} onChange={event => { setVersion(event.target.value === latest.version ? '' : event.target.value); setCopyMessage(''); }}>{[latest, ...entries.filter(item => item.version !== latest.version)].map(item => <option value={item.version} key={item.version}>{item.version}{item.version === latest.version ? ' (최신)' : ''}</option>)}</select></label>
      <p>{manifest.description}</p>
      <dl className="system-catalog-meta"><div><dt>이용 조건</dt><dd>{manifest.license}</dd></div><div><dt>제작·출처</dt><dd>{manifest.credits.join(', ') || '없음'}</dd></div><div><dt>실행 규격</dt><dd>{manifest.sdk}</dd></div></dl>
      <h3>연결할 대상</h3>
      {Object.entries(manifest.targets).length ? <ul>{Object.entries(manifest.targets).map(([name, target]) => <li key={name}><code>{name}</code> — {target.capabilities.map(capability => capabilities[capability]).join(', ')} · {target.required ? '필수' : '선택'} · {target.multiple ? '여러 오브젝트' : '오브젝트 1개'}</li>)}</ul> : <p>없음</p>}
      {manifest.interaction && <p>상호작용: <code>{manifest.interaction.target}</code>에 연결한 오브젝트를 누르면 <code>{manifest.interaction.input}</code> 입력을 호출합니다.</p>}
      <h3>설정</h3><Fields fields={manifest.config} />
      <h3>입력 이벤트</h3><Ports ports={manifest.inputs} />
      <h3>출력 이벤트</h3><Ports ports={manifest.outputs} />
      <details><summary>초기 상태와 업데이트 규칙</summary><Fields fields={manifest.state} /><p>맵은 시스템 ID로 연결합니다. 호환되는 업데이트는 기존 연결과 실행 상태를 유지하며, 호환되지 않으면 보존된 버전을 사용합니다.</p>{manifest.migrations?.length ? <pre>{JSON.stringify(manifest.migrations, null, 2)}</pre> : <p>별도 상태 이름 변경 규칙 없음</p>}</details>
      <h3>맵 코드 연결 예제 · 최신 {latest.version}</h3><p>새 맵 연결 예제는 최신 버전 기준입니다. 대상 ID·위치·설정을 내 맵에 맞게 수정하고, 외형은 맵 코드에서 만드세요. 위 버전 선택은 정보 조회용이며 예제에는 버전을 고정하지 않습니다.</p><button type="button" onClick={() => void copy()}>연결 예제 복사</button><span role="status">{copyMessage}</span><pre>{code}</pre>
      <details><summary>작동 로직과 원본 보기</summary><p><a href={`/system-originals/${encodeURIComponent(entry.integrity)}`} target="_blank" rel="noreferrer">서버에 보관된 원본 JSON 열기</a></p><p className="system-catalog-hash">원본 식별값: {entry.integrity}</p><pre>{JSON.stringify(manifest, null, 2)}</pre></details>
    </div>
  </details>;
}

export function SystemCatalogBrowser() {
  const [catalog, setCatalog] = useState<SystemCatalog>(), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0), [search, setSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void fetch('/api/shared-systems', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('등록된 시스템 목록을 불러오지 못했습니다.');
      const next = await response.json() as SystemCatalog;
      if (next.schema !== 1 || !Array.isArray(next.entries)) throw new Error('시스템 목록 형식을 확인해 주세요.');
      if (!controller.signal.aborted) setCatalog(next);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const ids = catalog ? [...new Set(catalog.entries.map(entry => entry.id))].sort() : [], query = search.trim().toLocaleLowerCase();
  const visible = ids.filter(id => catalog!.entries.some(entry => entry.id === id && [id, entry.version, entry.manifest.title, entry.manifest.description, ...entry.manifest.credits, ...Object.keys(entry.manifest.inputs), ...Object.keys(entry.manifest.outputs)].join(' ').toLocaleLowerCase().includes(query)));
  return <div className="system-catalog">
    <p>중앙 서버에 공개된 동작 시스템입니다. 오브젝트는 맵에서 만들고 아래 대상 이름과 연결하세요.</p>
    <SystemLibraryGuide />
    <div className="system-catalog-actions"><button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading}>목록 새로고침</button></div>
    <label className="system-catalog-search">시스템 검색<input type="search" placeholder="이름, ID, 설명, 이벤트" value={search} onChange={event => setSearch(event.target.value)} /></label>
    {loading && <p role="status">시스템 목록을 불러오는 중…</p>}{error && <p role="alert">{error}</p>}
    {catalog && <><p className="system-catalog-count">등록된 시스템 {ids.length}개 · 공개된 버전 {catalog.entries.length}개{query && ` · 검색 결과 ${visible.length}개`}</p>{!loading && !ids.length && <p>아직 등록된 시스템이 없습니다. 등록 가이드에 따라 첫 시스템을 제출하세요.</p>}{!!ids.length && !visible.length && <p>검색 결과가 없습니다.</p>}{visible.map(id => <CatalogItem key={id} entries={catalog.entries.filter(entry => entry.id === id)} latest={latestSystem(catalog, id)!} />)}<details className="system-catalog-release"><summary>현재 서버의 등록 기록</summary><p>{catalog.commit}</p><a href="/api/shared-systems" target="_blank" rel="noreferrer">카탈로그 JSON 열기</a></details></>}
    <SystemItemCatalog />
  </div>;
}
