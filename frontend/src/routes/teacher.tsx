import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchAnalytics, type AnalyticsRow, ApiError } from "@/lib/api";

export const Route = createFileRoute("/teacher")({
  head: () => ({
    meta: [
      { title: "Müəllim paneli — AI Tutor" },
      {
        name: "description",
        content: "Material üzrə sual sayı, ən çox təkrarlanan mövzular və sadə analitika.",
      },
      { property: "og:title", content: "Müəllim paneli — AI Tutor" },
      { property: "og:description", content: "Şagird suallarının analitikası bir ekranda." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TeacherPanel,
});

function TeacherPanel() {
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAnalytics();
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Analitika yüklənmədi");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = rows.map((r) => ({ name: r.material_name, sual: r.question_count }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="text-sm font-semibold">Müəllim paneli</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Analitika yüklənir...
          </div>
        ) : error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Hələ heç bir sual verilməyib. Şagirdlər sual verdikcə burada statistika görünəcək.
          </p>
        ) : (
          <>
            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <h2 className="text-sm font-semibold">Materiallar üzrə sual statistikası</h2>
              <div className="mt-6 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "var(--accent)" }} />
                    <Bar dataKey="sual" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <h2 className="text-sm font-semibold">Materiallar</h2>
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Sual sayı</TableHead>
                    <TableHead>Ən çox soruşulan mövzu</TableHead>
                    <TableHead className="text-right">Guardrail bloklayıb</TableHead>
                    <TableHead className="text-right">Quiz cəhdi</TableHead>
                    <TableHead className="text-right">Orta bal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.material_id}>
                      <TableCell className="font-medium">{r.material_name}</TableCell>
                      <TableCell className="text-right">{r.question_count}</TableCell>
                      <TableCell className="text-muted-foreground">{r.top_topic}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {r.guardrail_blocked_count ?? 0}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {r.quiz_attempts ?? 0}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {r.quiz_avg_score_percent != null ? `${r.quiz_avg_score_percent}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
