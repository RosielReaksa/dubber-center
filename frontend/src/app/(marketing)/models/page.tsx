"use client";

import { Suspense, useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type Model } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { languageName } from "@/lib/format";
import { useDebounce } from "@/hooks";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/common/states";
import { ModelCard, ModelGridCard } from "@/components/models/model-card";

const filters = ["type", "source", "target", "maxPrice", "features", "status", "healthy", "sort", "q"] as const;
function Catalog() {
  const params = useSearchParams(); const router = useRouter();
  const [term, setTerm] = useState(params.get("q") ?? ""); const query = useDebounce(term, 200);
  const [grid, setGrid] = useState(false);
  useEffect(() => { try { setGrid(localStorage.getItem("models-view") === "grid"); } catch {} }, []);
  const update = (key: string, value: string) => { const next = new URLSearchParams(params.toString()); if (value) next.set(key, value); else next.delete(key); router.replace(`/models${next.size ? `?${next}` : ""}`, { scroll: false }); };
  useEffect(() => { update("q", query); }, [query]);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: queryKeys.models(), queryFn: () => api.models() });
  const models = useMemo(() => {
    let rows = (data?.data ?? []).filter((m: Model) => [m.name, m.id, m.description ?? ""].some(s => s.toLowerCase().includes(query.toLowerCase())));
    const types = params.getAll("type"); if (types.length) rows = rows.filter(m => types.includes(m.type));
    if (params.get("source")) rows = rows.filter(m => m.languages.source.includes(params.get("source")!));
    if (params.get("target")) rows = rows.filter(m => m.languages.target.includes(params.get("target")!));
    if (params.get("maxPrice")) rows = rows.filter(m => m.price_per_minute <= Number(params.get("maxPrice")));
    const feats = params.getAll("features"); if (feats.length) rows = rows.filter(m => feats.every(f => m.features.includes(f)));
    const statuses = params.getAll("status"); if (statuses.length) rows = rows.filter(m => statuses.includes(m.status));
    if (params.get("healthy") === "1") rows = rows.filter(m => m.health_state === "healthy");
    const sort = params.get("sort"); rows.sort(sort === "cheapest" ? (a,b) => a.price_per_minute-b.price_per_minute : sort === "fastest" ? (a,b) => (a.avg_duration_sec ?? Infinity)-(b.avg_duration_sec ?? Infinity) : sort === "newest" ? (a,b) => b.version-a.version : sort === "reliable" ? (a,b) => (b.uptime_30d ?? -1)-(a.uptime_30d ?? -1) : () => 0);
    return rows;
  }, [data, query, params]);
  const clear = () => { setTerm(""); router.replace("/models"); };
  return <><PageHeader title="Model catalog" description="Compare dubbing models by language, price and availability." />
    <label className="label" htmlFor="model-search">Search models</label><input id="model-search" className="input mb-5 max-w-xl" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search name, ID or description" />
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]"><aside className="space-y-4">
      <fieldset><legend className="label">Type</legend>{["api","local","hybrid"].map(x => <label key={x} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={params.getAll("type").includes(x)} onChange={e => { const a=params.getAll("type").filter(v=>v!==x); if(e.target.checked)a.push(x); const n=new URLSearchParams(params.toString()); n.delete("type"); a.forEach(v=>n.append("type",v)); router.replace(`/models?${n}`); }} />{x}</label>)}</fieldset>
      {([ ["source","Source language"], ["target","Target language"] ] as const).map(([key,title]) => <label key={key} className="label">{title}<select className="input" value={params.get(key) ?? ""} onChange={e => update(key,e.target.value)}><option value="">Any</option>{(data?.languages.source ?? []).concat(data?.languages.target ?? []).filter((v,i,a)=>a.indexOf(v)===i).map(v=><option key={v} value={v}>{languageName(v)}</option>)}</select></label>)}
      <label className="label">Maximum price per minute<input aria-label="Maximum price per minute" type="range" min="0" max="10" step="0.1" value={params.get("maxPrice") ?? "10"} onChange={e=>update("maxPrice",e.target.value === "10" ? "" : e.target.value)} /><span className="hint">${params.get("maxPrice") ?? "10"}</span></label>
      <fieldset><legend className="label">Features</legend>{["subtitles","multi_speaker"].map(x=><label className="flex gap-2 py-1 text-sm" key={x}><input type="checkbox" checked={params.getAll("features").includes(x)} onChange={e=>{const n=new URLSearchParams(params.toString());n.delete("features");const a=params.getAll("features").filter(v=>v!==x);if(e.target.checked)a.push(x);a.forEach(v=>n.append("features",v));router.replace(`/models?${n}`)}} />{x.replace("_"," ")}</label>)}</fieldset>
      <fieldset><legend className="label">Status</legend>{["active","beta"].map(x=><label className="flex gap-2 py-1 text-sm" key={x}><input type="checkbox" checked={params.getAll("status").includes(x)} onChange={e=>{const n=new URLSearchParams(params.toString());n.delete("status");const a=params.getAll("status").filter(v=>v!==x);if(e.target.checked)a.push(x);a.forEach(v=>n.append("status",v));router.replace(`/models?${n}`)}} />{x}</label>)}</fieldset>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={params.get("healthy")==="1"} onChange={e=>update("healthy",e.target.checked?"1":"")} />Healthy only</label>
    </aside><section><div className="mb-4 flex flex-wrap justify-between gap-3"><label className="label">Sort<select className="input ml-2 w-auto" value={params.get("sort")??"popular"} onChange={e=>update("sort",e.target.value==="popular"?"":e.target.value)}><option value="popular">Popular</option><option value="cheapest">Cheapest</option><option value="fastest">Fastest</option><option value="newest">Newest</option><option value="reliable">Most reliable</option></select></label><button className="btn btn-secondary" onClick={()=>{const v=!grid;setGrid(v);try{localStorage.setItem("models-view",v?"grid":"list")}catch{}}}>{grid?"List view":"Grid view"}</button></div>
      <div aria-live="polite">{isLoading ? <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-24" />)}</div> : isError ? <ErrorState onRetry={()=>refetch()} /> : models.length ? <div className={grid?"grid gap-3 md:grid-cols-2":"space-y-3"}>{models.map(m=>grid?<ModelGridCard key={m.id} model={m}/>:<ModelCard key={m.id} model={m}/>)}</div> : <EmptyState title="No models match these filters" action={<button className="btn btn-secondary" onClick={clear}>Clear filters</button>} />}</div>
    </section></div></>;
}
export default function ModelsPage() { return <Suspense fallback={<Skeleton className="h-64" />}><Catalog /></Suspense>; }
