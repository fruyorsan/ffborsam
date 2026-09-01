import { generateText } from "ai"
import { z } from "zod"

const requestSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{3,10}$/),
  question: z.string().trim().min(3).max(500),
  market: z.object({
    price: z.number(), change: z.number(), updatedAt: z.string().optional(), source: z.string().optional(),
    technical: z.object({ signal: z.string(), confidence: z.number(), support: z.number(), resistance: z.number(), values: z.record(z.string(), z.number()) }),
    advice: z.array(z.object({ label: z.string(), signal: z.string(), action: z.string(), invalidation: z.number(), target: z.number() })).max(4),
    news: z.array(z.object({ title: z.string(), source: z.string(), publishedAt: z.string().nullish(), url: z.string().optional() }).passthrough()).max(8),
    macro: z.array(z.object({ symbol: z.string(), name: z.string(), price: z.number().optional(), change: z.number().optional(), ok: z.boolean() })).max(12).optional(),
  }),
})

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Geçersiz analiz isteği" }, { status: 400 })
  const { symbol, market, question } = parsed.data
  const technical = `Fiyat ${market.price}; günlük değişim %${market.change.toFixed(2)}; konsensüs ${market.technical.signal}; model güveni %${market.technical.confidence}; destek ${market.technical.support}; direnç ${market.technical.resistance}; RSI ${market.technical.values.rsi?.toFixed(2)}; MACD ${market.technical.values.macd?.toFixed(2)}; MACD sinyal ${market.technical.values.macdSignal?.toFixed(2)}; Stochastic ${market.technical.values.stochastic?.toFixed(2)}; ATR ${market.technical.values.atr?.toFixed(2)}; EMA20 ${market.technical.values.sma20?.toFixed(2)}; EMA50 ${market.technical.values.sma50?.toFixed(2)}`
  const horizons = market.advice.map(item => `${item.label}: ${item.signal}, ${item.action}, risk/geçersizleşme ${item.invalidation}, izlenecek direnç ${item.target}`).join("; ")
  const news = market.news.length ? market.news.map(item => `[${item.source}${item.publishedAt ? ` · ${item.publishedAt}` : " · tarih yok"}] ${item.title}`).join("\n") : "Kaynaklı güncel haber yok."
  const macro = market.macro?.length ? market.macro.map(item => `${item.name} (${item.symbol}): ${item.price ?? "veri yok"}, değişim ${typeof item.change === "number" ? `%${item.change.toFixed(2)}` : "yok"}`).join("; ") : "Makro bağlam sağlanmadı."

  try {
    const { text } = await generateText({
      model: "anthropic/claude-sonnet-5",
      temperature: 0.1,
      maxOutputTokens: 600,
      system: "Sen ihtiyatlı bir Türkçe şirket ve piyasa analiz asistanısın. Teknik sinyali tekrar edip bırakma; şirketin iş modeline göre verilen emtia, kur, endeks ve haberlerin olası aktarım kanalını açıkla. Örneğin rafineri şirketinde petrol ve marj, ihracatçıda kur, bankada faiz ve endeks bağlamını ilişkilendir. Yalnız verilen veriyi kullan; bilanço, fiyat, haber veya olay uydurma. Bilanço verisi verilmediyse açıkça 'bilanço verisi sağlanmadı' de ve kontrol edilecek kalemleri belirt. Kesin getiri, kesin yön veya alım-satım emri verme. Yanıtı Eylem özeti, Şirketi etkileyenler, İzlenecek teyitler ve Ana risk başlıklarıyla en fazla 180 kelime yaz.",
      prompt: `Kullanıcı sorusu: ${question}\n\nSembol: ${symbol}\nVeri kaynağı: ${market.source ?? "Yahoo Finance (gecikmeli)"}\nPiyasa zamanı: ${market.updatedAt ?? "belirtilmedi"}\nTeknik veri: ${technical}\nMakro ve emtia bağlamı: ${macro}\nVade planları: ${horizons}\nKaynaklı başlıklar:\n${news}\n\nYanıtta önce net bir özet, sonra soruya doğrudan cevap, izlenecek seviyeler, haber etkisi ve ana risk olsun. Son satırda bunun yatırım tavsiyesi olmadığını belirt.`,
    })
    return Response.json({ text, source: "claude", model: "anthropic/claude-sonnet-5" })
  } catch {
    const nearest = market.advice.map(item => `${item.label}: ${item.action} (${item.signal})`).join("\n")
    return Response.json({
      text: `Özet\n${symbol} teknik konsensüsü ${market.technical.signal}; gösterge güveni %${market.technical.confidence}.\n\nVade planı\n${nearest}\n\nİzlenecek seviyeler\n${market.technical.support.toFixed(2)} altı mevcut görünümü zayıflatabilir; ${market.technical.resistance.toFixed(2)} üstü teyit gerektirir.\n\nHaber ve risk\n${market.news.length ? "Kaynaklı başlıklar mevcut ancak içerikleri doğrulanmadan teknik sonucu değiştiren olay kabul edilmedi." : "Kaynaklı güncel haber bulunmadığı için haber etkisi çıkarılmadı."}\n\nBu kural tabanlı özet yatırım tavsiyesi değildir.`,
      source: "fallback",
    })
  }
}
