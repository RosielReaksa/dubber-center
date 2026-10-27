"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard, Info } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageHeader, QueryState } from "@/components/common/states";
import { useAuth } from "@/lib/auth/auth-context";
import { friendlyError, request } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { exactTime, money, relativeTime } from "@/lib/format";

interface Transaction {
  id: string;
  amount: number;
  balance_after: number;
  reason: string;
  job_id: string | null;
  created_at: string;
}

const LOW_BALANCE = 5;

export default function CreditsPage() {
  const { user } = useAuth();
  const [topUpOpen, setTopUpOpen] = useState(false);

  const transactionsQuery = useQuery({
    queryKey: queryKeys.creditsTransactions(),
    queryFn: () => request<{ data: Transaction[] }>("/v1/credits/transactions"),
  });

  const balance = user?.credits ?? 0;
  const transactions = transactionsQuery.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Credits"
        description="Credits pay for dubbing minutes. Each job charges its final cost when it finishes."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setTopUpOpen(true)}>
            <CreditCard size={14} /> Add credits
          </button>
        }
      />

      {balance < LOW_BALANCE ? (
        <div
          className="mb-5 flex items-start gap-2.5 rounded-md border px-4 py-3 text-[13px]"
          style={{ borderColor: "var(--warning)", background: "var(--warning-soft)", color: "var(--warning)" }}
          role="status"
        >
          <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Your balance is low. Jobs can only start while you have credits, and the estimate is
            checked before each job.
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="card card-pad">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Current balance
          </p>
          <p className="mt-1 font-serif text-3xl">{money(balance)}</p>
          <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
            Plan: {user?.plan ?? "free"}
          </p>
        </section>

        <section className="card card-pad">
          <h2 className="mb-1 text-[13px] font-medium">How credits work</h2>
          <ul className="mt-2 space-y-1.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
            <li>· The cost estimate is price per minute × video length.</li>
            <li>· The final charge uses the real duration when the job finishes.</li>
            <li>· A failed or canceled job is not charged.</li>
            <li>· Every balance change is recorded below.</li>
          </ul>
        </section>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-[13px] font-medium">Recent transactions</h2>
        <div className="card overflow-hidden">
          <QueryState
            isLoading={transactionsQuery.isLoading}
            error={transactionsQuery.error}
            isEmpty={!transactions.length}
            empty="No transactions yet. Top-ups and job charges will appear here."
            onRetry={() => void transactionsQuery.refetch()}
          />

          {transactions.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Reason</th>
                    <th scope="col" className="text-right">
                      Amount
                    </th>
                    <th scope="col" className="text-right">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((row) => (
                    <tr key={row.id}>
                      <td title={exactTime(row.created_at)}>{relativeTime(row.created_at)}</td>
                      <td className="max-w-[320px] truncate">{row.reason}</td>
                      <td
                        className="text-right font-medium"
                        style={{ color: row.amount >= 0 ? "var(--success)" : "var(--text)" }}
                      >
                        {row.amount >= 0 ? "+" : ""}
                        {money(row.amount)}
                      </td>
                      <td className="text-right">{money(row.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>

      <ConfirmDialog
        open={topUpOpen}
        title="Add credits"
        description={
          <>
            Card payments are not enabled yet. Ask an administrator to add credits to
            <span className="mono"> {user?.email}</span> and they will appear here as a transaction.
          </>
        }
        confirmLabel="Got it"
        onCancel={() => setTopUpOpen(false)}
        onConfirm={() => setTopUpOpen(false)}
      >
        <div className="grid grid-cols-3 gap-2">
          {[10, 25, 100].map((amount) => (
            <div
              key={amount}
              className="rounded-sm border px-3 py-2 text-center text-[13px]"
              style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
            >
              {money(amount)}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
          {friendlyError({ message: "Amounts shown for reference only." } as Error)}
        </p>
      </ConfirmDialog>
    </div>
  );
}