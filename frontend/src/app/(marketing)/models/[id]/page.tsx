"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, API_URL } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { CopyButton } from "@/components/common/copy-button";
import { ErrorState, PageHeader, Skeleton } from "@/components/common/states";
import { StatusBanner, StatusDot, UptimeBar, IncidentList } from "@/components/common/status";
import { languageName, money, pricePerMinute, percent, duration, relativeTime } from "@/lib/format";

export default function ModelDetailPage() {
  const { id } = useParams<{id:string}>(); const [tab,setTab]=useState("Overview"); const [lang,setLang]=useState(""); const [mins,setMins]=useState(1); const [code,setCode]=useState("curl");
  const modelQ=useQuery({queryKey:queryKeys.model(id),queryFn:()=>api.model(id)});
  const statusQ=useQuery({queryKey:queryKeys.modelStatus(id),queryFn:()=>api.modelStatus(id),enabled:tab==="Status"});
  if(modelQ.isLoading)return <Skeleton className="h-48"/>; if(modelQ.isError||!modelQ.data)return <ErrorState onRetry={()=>modelQ.refetch()}/>;
  const m=modelQ.data; const base=API_URL; const payload=JSON.stringify({model:m.id,video_url:"https://example.com/video.mp4",source_lang:"en",target_lang:"km"},null,2);
  const snippets={curl:`curl -X POST ${base}/v1/dub -H 'Authorization: Bearer YOUR_API_KEY' -H 'Content-Type: application/json' -d '${payload.replaceAll("'","\\'")}'`,python:`import requests\nrequests.post('${base}/v1/dub', headers={'Authorization': 'Bearer YOUR_API_KEY'}, json=${JSON.stringify({model:m.id,video_url:"https://example.com/video.mp4",source_lang:"en",target_lang:"km"})})`,javascript:`await fetch('${base}/v1/dub', { method: 'POST', headers: { Authorization: 'Bearer YOUR_API_KEY', 'Content-Type': 'application/json' }, body: JSON.stringify(${payload}) });`};
  const tabs=["Overview","Languages","Pricing","Try it","API","Status"];
  return <><PageHeader title={m.name} description={<span className="mono">{m.id} <CopyButton value={m.id} label="ID"/></span>} actions={<><span className="badge badge-neutral">{m.type}</span><StatusDot state={m.health_state} checkedAt={m.health_checked_at} beta={m.status==="beta"}/><Link className="btn btn-primary" href={`/dub?model=${encodeURIComponent(m.id)}`}>Try this model</Link><Link className="btn btn-secondary" href="/docs">Use in API</Link></>}/>
  <nav className="mb-6 flex flex-wrap gap-5 border-b" aria-label="Model details">{tabs.map(t=><button key={t} onClick={()=>setTab(t)} className="border-b-2 px-1 py-2 text-sm" style={{borderColor:tab===t?"var(--accent)":"transparent",color:tab===t?"var(--text)":"var(--text-muted)"}}>{t}</button>)}</nav>
  {tab==="Overview"&&<div className="card card-pad"><p>{m.description||"No description provided."}</p><div className="mt-5 flex flex-wrap gap-2">{m.features.map(f=><span className="badge badge-neutral" key={f}>{f.replaceAll("_"," ")}</span>)}</div><dl className="mt-6 grid gap-4 sm:grid-cols-2">{[["Maximum video length",`${m.max_video_minutes} minutes`],["Concurrency",String(m.max_concurrent)],["Average duration",duration(m.avg_duration_sec)],["Success rate",percent(m.success_rate_24h)]].map(([k,v])=><div key={k}><dt className="text-xs" style={{color:"var(--text-muted)"}}>{k}</dt><dd>{v}</dd></div>)}</dl></div>}
  {tab==="Languages"&&<div className="card card-pad"><label className="label">Search languages<input className="input max-w-sm" value={lang} onChange={e=>setLang(e.target.value)}/></label><div className="mt-4 grid gap-6 sm:grid-cols-2">{[["Source languages",m.languages.source],["Target languages",m.languages.target]].map(([title,items])=><div key={title as string}><h2 className="mb-2 text-base">{title} ({(items as string[]).length})</h2>{(items as string[]).filter(x=>`${x} ${languageName(x)}`.toLowerCase().includes(lang.toLowerCase())).map(x=><div className="border-t py-2" key={x}>{languageName(x)} <span className="mono text-xs" style={{color:"var(--text-muted)"}}>{x}</span></div>)}</div>)}</div></div>}
  {tab==="Pricing"&&<div className="card card-pad"><p className="text-lg">{pricePerMinute(m.price_per_minute)}</p><label className="label mt-5">Minutes<input className="input max-w-xs" type="number" min="0" step="0.1" value={mins} onChange={e=>setMins(Number(e.target.value))}/></label><p className="mt-3">Estimated cost: <strong>{money(Math.max(0,mins)*m.price_per_minute)}</strong></p><p className="hint">Includes dubbing through this model. Final cost may vary with actual duration.</p></div>}
  {tab==="Try it"&&<div className="panel p-6"><h2 className="text-lg">Try it in the playground</h2><p className="mt-2" style={{color:"var(--text-muted)"}}>The full dubbing playground lets you upload a video and preview the result.</p><Link className="btn btn-primary mt-4" href={`/dub?model=${encodeURIComponent(m.id)}`}>Open playground</Link></div>}
  {tab==="API"&&<div><div className="mb-3 flex gap-2">{Object.keys(snippets).map(x=><button className="btn btn-secondary" key={x} onClick={()=>setCode(x)}>{x}</button>)}</div><pre className="card overflow-auto p-4 text-xs"><code>{snippets[code as keyof typeof snippets]}</code></pre><CopyButton value={snippets[code as keyof typeof snippets]} label="code"/></div>}
  {tab==="Status"&&(statusQ.isLoading?<Skeleton className="h-48"/>:statusQ.isError||!statusQ.data?<ErrorState onRetry={()=>statusQ.refetch()}/>:<><StatusBanner state={statusQ.data.health_state} modelId={m.id}/><div className="card card-pad"><StatusDot state={statusQ.data.health_state} since={statusQ.data.health_since} checkedAt={statusQ.data.checked_at}/><p className="mt-4">Health since {relativeTime(statusQ.data.health_since)} · checked {relativeTime(statusQ.data.checked_at)}</p><div className="my-4"><UptimeBar days={statusQ.data.daily} uptime={statusQ.data.uptime_30d}/></div><h2 className="mb-2 text-base">Recent incidents</h2><IncidentList incidents={statusQ.data.incidents}/></div></>)}
  </>;
}
