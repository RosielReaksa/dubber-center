"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { useDocumentVisible } from "@/hooks";
import { ErrorState, PageHeader, Skeleton, EmptyState } from "@/components/common/states";
import { StatusDot, UptimeBar } from "@/components/common/status";
import { relativeTime } from "@/lib/format";

export default function StatusPage() {
 const visible=useDocumentVisible(); const q=useQuery({queryKey:queryKeys.publicStatus(),queryFn:api.status,refetchInterval:visible?60000:false});
 const details=useQueries({queries:(q.data?.models??[]).map(m=>({queryKey:queryKeys.modelStatus(m.id),queryFn:()=>api.modelStatus(m.id),refetchInterval:visible?60000:false}))});
 return <><PageHeader title="Service status" description="Live availability for public dubbing models."/>{q.isLoading?<div className="space-y-3">{[1,2,3].map(x=><Skeleton className="h-16" key={x}/>)}</div>:q.isError||!q.data?<ErrorState onRetry={()=>q.refetch()}/>:<>
 {q.data.incidents.length?<section className="card card-pad mb-6"><h2 className="mb-3 text-lg">Ongoing incidents</h2><ul className="space-y-3">{q.data.incidents.map((i,n)=><li key={`${i.model}-${n}`}><strong>{i.model}</strong> · {i.summary}<p className="text-xs" style={{color:"var(--text-muted)"}}>{i.ended_at?`Resolved ${relativeTime(i.ended_at)}`:`Started ${relativeTime(i.started_at)}`}</p></li>)}</ul></section>:<p className="mb-6 flex items-center gap-2" role="status"><span className="h-2.5 w-2.5 rounded-full" style={{background:"var(--success)"}}/>All systems normal</p>}
 {q.data.models.length?<div className="card overflow-x-auto"><table className="table"><thead><tr><th>Model</th><th>Status</th><th>30-day uptime</th></tr></thead><tbody>{q.data.models.map((m,i)=><tr key={m.id}><td>{m.name}</td><td><StatusDot state={m.health_state}/></td><td><UptimeBar days={details[i]?.data?.daily??[]} uptime={m.uptime_30d}/></td></tr>)}</tbody></table></div>:<EmptyState title="No public models"/>}</>}</>;
}
