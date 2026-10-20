// /go/mail/<id>?t=<подпись> — страница «📨 Открыть почту» для черновика письма
// из бота: кнопка mailto: с готовым письмом и текст для копирования. Ничего
// не отправляет — письмо отправляет пользователь из своей почты.

import { manualSenders, outlookComposeUrl } from "@/lib/leads/outreach/senders";
import { verifyOutreachLink } from "@/lib/leads/outreach/links";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>
:root{color-scheme:dark}body{margin:0;background:#060606;color:#f2f1ec;font:15px/1.5 -apple-system,Segoe UI,Inter,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px 40px}h1{font-size:19px;margin:0 0 4px}.sub{color:#9a9a93;font-size:13px;margin-bottom:18px}
.row{margin:10px 0}.k{color:#5d5d58;font-size:11px;letter-spacing:.1em;text-transform:uppercase}.v{font-weight:600;word-break:break-word}
textarea{width:100%;box-sizing:border-box;min-height:260px;background:#121212;color:#f2f1ec;border:1px solid #2a2a2a;border-radius:12px;padding:12px;font:14px/1.5 inherit;resize:vertical}
a.btn,button{display:block;width:100%;box-sizing:border-box;text-align:center;padding:14px;border-radius:12px;border:none;font-weight:700;font-size:15px;text-decoration:none;margin-top:10px;cursor:pointer}
a.btn{background:#b8ff3c;color:#08110a}a.btn.alt,button{background:#181818;color:#f2f1ec;border:1px solid #2a2a2a}.sub a{color:#f2f1ec}.note{color:#e7b24c;font-size:13px;margin-top:10px}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const token = new URL(request.url).searchParams.get("t");
  if (!verifyOutreachLink(params.id, token)) return page("Ссылка недействительна", "<h1>Ссылка недействительна</h1><p class=sub>Открой письмо заново из бота.</p>", 404);

  const o = await prisma.outreach.findUnique({ where: { id: params.id }, include: { lead: { select: { name: true } } } });
  if (!o || o.channel !== "EMAIL") return page("Письмо не найдено", "<h1>Письмо не найдено</h1><p class=sub>Возможно, черновик удалён.</p>", 404);
  // открыл почту с готовым текстом → «📤 Готово к отправке» (отправленным отметит сам пользователь)
  if (o.status === "DRAFT") await prisma.outreach.update({ where: { id: o.id }, data: { status: "READY" } });

  const handoff = manualSenders.EMAIL.prepare({ recipient: o.recipient, subject: o.subject, body: o.body });
  const outlook = outlookComposeUrl("personal", o.recipient, o.subject, o.body);
  const outlookWork = outlookComposeUrl("work", o.recipient, o.subject, o.body);
  const fullInLink = !!handoff.url && handoff.url.includes("body=");
  return page(
    `Письмо для ${o.lead.name}`,
    `<h1>📧 Письмо для «${esc(o.lead.name)}»</h1><div class=sub>Проверь и отправь из своей почты. Бот ничего не отправляет сам.</div>
<div class=row><div class=k>Кому</div><div class=v>${o.recipient ? esc(o.recipient) : "email не найден"}</div></div>
${o.subject ? `<div class=row><div class=k>Тема</div><div class=v>${esc(o.subject)}</div></div>` : ""}
<div class=row><div class=k>Текст</div><textarea id=t readonly>${esc(o.body)}</textarea></div>
${handoff.url ? `<a class=btn href="${esc(handoff.url)}" onclick="copyText()">📨 Открыть почту</a>` : ""}
${outlook && outlookWork ? `<a class="btn alt" href="${esc(outlook)}" target=_blank rel=noopener onclick="copyText()">🌐 Открыть в Outlook</a>
<div class=sub style="margin:6px 0 0">Это Outlook.com — личная почта. Рабочая Microsoft 365 — <a href="${esc(outlookWork)}" target=_blank rel=noopener>открыть здесь</a>.</div>` : ""}
<button onclick="copyText().then(()=>this.textContent='✅ Скопировано')">📋 Скопировать текст</button>
${handoff.url ? `<div class=${fullInLink ? "sub" : "note"} style="margin:10px 0 0">${fullInLink ? "При нажатии текст ещё и копируется: если почта откроется без него, просто вставь." : "Текст слишком длинный для ссылки — почта откроется без него. При нажатии он копируется: просто вставь."}</div>` : ""}
<script>function copyText(){return navigator.clipboard.writeText(document.getElementById('t').value).catch(()=>{})}</script>
<div class=sub style="margin-top:18px">После отправки вернись в бот и нажми «✅ Я отправил».</div>`
  );
}
