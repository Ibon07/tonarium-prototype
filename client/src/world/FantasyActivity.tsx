import { useEffect, useState } from 'react';
import { FANTASY_WORLD_TIME_RATE, type FantasyProfile } from '../../../shared/fantasy.ts';
import { useStore } from '../store.ts';
import { useLocale } from '../locale.ts';
import { FANTASY_JOBS } from '../../../shared/fantasy-data.ts';
import { FANTASY_PROPERTY_PLOTS } from '../../../shared/fantasy-property.ts';
import { FANTASY_TERMS } from '../../../shared/fantasy-lore.ts';
import { fantasyKnownLocations } from '../../../shared/fantasy-town.ts';

export function realDuration(gameHours:number,locale:'ko'|'en'|'ja') {
  const seconds=Math.ceil(gameHours*3600/FANTASY_WORLD_TIME_RATE);
  if(seconds<60)return locale==='ko'?`실제 약 ${seconds}초`:locale==='en'?`About ${seconds} real sec`:`実時間 約${seconds}秒`;
  const minutes=Math.ceil(seconds/60);
  return locale==='ko'?`실제 약 ${minutes}분`:locale==='en'?`About ${minutes} real min`:`実時間 約${minutes}分`;
}

export function FantasyActivity({profile,onCancel,onRedirect}:{profile:FantasyProfile;onCancel?:()=>void;onRedirect?:(destination:string)=>void}) {
  const [locale]=useLocale();
  const clock=useStore(s=>s.fantasyClock);
  const [confirming,setConfirming]=useState(false);
  useEffect(()=>{ if(!confirming)return; const timer=setTimeout(()=>setConfirming(false),4000); return()=>clearTimeout(timer); },[confirming]);
  const activity=profile.activity;
  if(!activity)return null;
  const hour=clock?.hour??profile.character?.hour??activity.startedAt;
  const seconds=Math.max(0,Math.ceil((activity.endsAt-hour)*3600/FANTASY_WORLD_TIME_RATE));
  const remaining=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  const names={ko:{travel:'이동 중',work:'일하는 중',explore:'탐색 중',rest:'노숙 중',lodge:'휴식 중',eat:'식사 중',job:'직업을 배우는 중',craft:'제작 중',event:'행동 중'},en:{travel:'Traveling',work:'Working',explore:'Exploring',rest:'Camping',lodge:'Resting',eat:'Eating',job:'Learning a profession',craft:'Crafting',event:'Resolving a choice'},ja:{travel:'移動中',work:'仕事中',explore:'探索中',rest:'野宿中',lodge:'休息中',eat:'食事中',job:'職業を習得中',craft:'制作中',event:'行動中'}}[locale];
  const property=activity.action.type==='propertyUse'?FANTASY_PROPERTY_PLOTS.find(plot=>activity.action.type==='propertyUse'&&plot.id===activity.action.plot):undefined;
  const name=activity.action.type==='advanceJob'?{ko:'전문 분야를 배우는 중',en:'Learning a specialty',ja:'専門分野を学んでいる'}[locale]:property?({farmland:{ko:'농사 중',en:'Tending crops',ja:'畑の手入れ中'},commercial:{ko:'영업 중',en:'Running the business',ja:'営業中'},residence:{ko:'집에서 휴식 중',en:'Resting at home',ja:'自宅で休息中'}}[property.kind][locale]):activity.action.type==='priestBranch'?{ko:'성소에서 길을 배우는 중',en:'Learning a sacred path',ja:'聖所で道を学んでいる'}[locale]:activity.action.type==='pray'?{ko:'기도 중',en:'Praying',ja:'祈り中'}[locale]:activity.action.type==='manaTrain'?{ko:'마나 수련 중',en:'Practicing mana',ja:'マナ修練中'}[locale]:activity.action.type==='learn'?{ko:'기술을 배우는 중',en:'Learning a skill',ja:'技能を習得中'}[locale]:names[activity.action.type as keyof typeof names]??{ko:'진행 중',en:'In progress',ja:'進行中'}[locale];
  const action=activity.action;
  const job=action.type==='job'?FANTASY_JOBS.find(j=>j.id===action.job):null;
  const progress=Math.max(0,Math.min(1,(hour-activity.startedAt)/(activity.endsAt-activity.startedAt)));
  const travelling=action.type==='travel';
  const escort=travelling&&action.transport==='escort';
  const redirectLocked=travelling&&['ship','working-ship','escort'].includes(action.transport);
  const destinations=travelling&&onRedirect&&!redirectLocked&&profile.character
    ?fantasyKnownLocations(profile.character).filter(id=>id!==profile.character!.location):[];
  const placeName=(id:string)=>FANTASY_TERMS.find(term=>term.category==='place'&&term.id===id)?.names[locale]??id;
  const cancelLabel=confirming?{ko:'정말 취소할까요?',en:'Cancel for sure?',ja:'本当に取り消しますか？'}[locale]:{ko:'행동 취소',en:'Cancel action',ja:'行動を取り消す'}[locale];
  const cancelReason=escort?{ko:'호위 이동은 여기서 취소할 수 없습니다. 호위 의뢰를 포기해 주세요.',en:'An escort trip cannot be cancelled here. Abandon the escort instead.',ja:'護衛の移動はここでは取り消せません。護衛依頼を辞退してください。'}[locale]:undefined;
  return <div className="fr-activity" role="status"><div><b>{name}{job?` · ${job.names[locale]}`:''}</b><span>{seconds>0?`${{ko:'완료까지',en:'Time left',ja:'完了まで'}[locale]} ${remaining}`:{ko:'마무리 중…',en:'Finishing…',ja:'完了処理中…'}[locale]}</span></div><progress aria-label={name} value={progress} max={1}/>{onCancel&&<button type="button" className={confirming?'fr-cancel armed':'fr-cancel'} disabled={!!escort} title={cancelReason} onClick={()=>{ if(confirming){setConfirming(false);onCancel();}else setConfirming(true); }}>{cancelLabel}</button>}{!!destinations.length&&<details className="fr-redirect"><summary>{redirectLocked?{ko:'이 수단으로는 목적지를 바꿀 수 없습니다',en:'This transport cannot change course',ja:'この交通手段では進路を変えられません'}[locale]:{ko:'목적지 변경',en:'Change destination',ja:'目的地を変える'}[locale]}</summary><div className="fr-redirect-list">{destinations.map(id=>{const place=FANTASY_TERMS.find(term=>term.category==='place'&&term.id===id)?.names[locale]??id;return <button key={id} type="button" className="fr-redirect-item" title={placeName(id)} onClick={()=>{setConfirming(false);onRedirect?.(id);}}>{place}</button>;})}</div></details>}</div>;
}
