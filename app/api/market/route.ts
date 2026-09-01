import { NextRequest } from "next/server"
import { analyzeCandles, horizonAdvice, type Candle } from "@/lib/indicators"
import { bistStocks } from "@/lib/bist-stocks"

type Asset = { yahoo: string; name: string; market: "BIST" | "ABD" | "MAKRO" }
const assets: Record<string, Asset> = {
  AAPL:{yahoo:"AAPL",name:"Apple",market:"ABD"},MSFT:{yahoo:"MSFT",name:"Microsoft",market:"ABD"},NVDA:{yahoo:"NVDA",name:"NVIDIA",market:"ABD"},GOOGL:{yahoo:"GOOGL",name:"Alphabet",market:"ABD"},AMZN:{yahoo:"AMZN",name:"Amazon",market:"ABD"},META:{yahoo:"META",name:"Meta",market:"ABD"},TSLA:{yahoo:"TSLA",name:"Tesla",market:"ABD"},
  XU100:{yahoo:"XU100.IS",name:"BIST 100",market:"MAKRO"},XU030:{yahoo:"XU030.IS",name:"BIST 30",market:"MAKRO"},SP500:{yahoo:"^GSPC",name:"S&P 500",market:"MAKRO"},NASDAQ:{yahoo:"^IXIC",name:"Nasdaq",market:"MAKRO"},DJI:{yahoo:"^DJI",name:"Dow Jones",market:"MAKRO"},USDTRY:{yahoo:"TRY=X",name:"Dolar / TL",market:"MAKRO"},EURTRY:{yahoo:"EURTRY=X",name:"Euro / TL",market:"MAKRO"},XAUUSD:{yahoo:"GC=F",name:"Ons Altın",market:"MAKRO"},BRENT:{yahoo:"BZ=F",name:"Brent Petrol",market:"MAKRO"},
}
// Merge the full BIST equity universe (yahoo symbol = `${ticker}.IS`).
for (const [ticker, name] of Object.entries(bistStocks)) {
  assets[ticker] = { yahoo: `${ticker}.IS`, name, market: "BIST" }
}
const headers={"User-Agent":"Mozilla/5.0 PiyasaIQ/1.0"}
// Yahoo quoteSummary requires a session cookie + crumb. Cache them briefly.
let session:{cookie:string;crumb:string;expires:number}|null=null
async function getSession(){
 if(session&&session.expires>Date.now())return session
 try{
  const c=new AbortController(),t=setTimeout(()=>c.abort(),8000)
  try{
   const cookieRes=await fetch("https://fc.yahoo.com",{headers,signal:c.signal})
   const raw=cookieRes.headers.get("set-cookie");if(!raw)return null
   const cookie=raw.split(";")[0]
   const crumbRes=await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb",{headers:{...headers,cookie},signal:c.signal})
   if(!crumbRes.ok)return null
   const crumb=(await crumbRes.text()).trim();if(!crumb||crumb.includes("<"))return null
   session={cookie,crumb,expires:Date.now()+50*60*1000}
   return session
  }finally{clearTimeout(t)}
 }catch{return null}
}
async function fetchChart(symbol:string,range="1y",interval="1d"){
 const item=assets[symbol]; if(!item) throw new Error("Desteklenmeyen sembol")
 const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),8000)
 try { const response=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.yahoo)}?range=${range}&interval=${interval}&events=div%2Csplits`,{signal:controller.signal,headers,next:{revalidate:300}})
  if(!response.ok) throw new Error(`Yahoo ${response.status}`); const payload=await response.json(); const result=payload?.chart?.result?.[0], quote=result?.indicators?.quote?.[0]
  if(!result?.timestamp||!quote) throw new Error("Eksik piyasa yanıtı")
  const candles:Candle[]=result.timestamp.flatMap((t:number,i:number)=>{const open=quote.open?.[i],high=quote.high?.[i],low=quote.low?.[i],close=quote.close?.[i],volume=quote.volume?.[i]??0;return [open,high,low,close].every(Number.isFinite)?[{date:new Intl.DateTimeFormat("tr-TR",{day:"2-digit",month:"short"}).format(new Date(t*1000)),open,high,low,close,volume}]:[]})
  return {item,meta:result.meta,candles}
 } finally {clearTimeout(timeout)}
}
async function analystData(item:Asset){
 if(item.market==="MAKRO") return null
 try {
  const s=await getSession();if(!s)return null
  const r=await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(item.yahoo)}?modules=financialData,recommendationTrend&crumb=${encodeURIComponent(s.crumb)}`,{headers:{...headers,cookie:s.cookie},next:{revalidate:3600}})
  if(!r.ok)return null
  const root=(await r.json())?.quoteSummary?.result?.[0]
  const f=root?.financialData
  const trend=root?.recommendationTrend?.trend?.find((t:{period?:string})=>t.period==="0m")??root?.recommendationTrend?.trend?.[0]
  const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0
  let distribution=null
  if(trend){
   const strongBuy=num(trend.strongBuy),buy=num(trend.buy),hold=num(trend.hold),sell=num(trend.sell),strongSell=num(trend.strongSell)
   const total=strongBuy+buy+hold+sell+strongSell
   if(total>0)distribution={buy:strongBuy+buy,hold,sell:sell+strongSell,total}
  }
  if(!f&&!distribution)return null
  return{rating:f?.recommendationKey??null,score:f?.recommendationMean?.raw??null,targetLow:f?.targetLowPrice?.raw??null,targetMean:f?.targetMeanPrice?.raw??null,targetHigh:f?.targetHighPrice?.raw??null,analystCount:f?.numberOfAnalystOpinions?.raw??distribution?.total??null,distribution}
 }catch{return null}
}
async function fetchNews(query:string,count=6){try{const r=await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}`,{headers,next:{revalidate:300}});if(!r.ok)return[];const p=await r.json();return(p.news??[]).slice(0,count).map((a:{title?:string;publisher?:string;providerPublishTime?:number;link?:string})=>({title:a.title??"Başlık bulunamadı",source:a.publisher??"Yahoo Finance",url:a.link,publishedAt:a.providerPublishTime?new Date(a.providerPublishTime*1000).toISOString():null}))}catch{return[]}}
export async function GET(request:NextRequest){
 const symbol=request.nextUrl.searchParams.get("symbol")?.toUpperCase()??"TUPRS"
 if(request.nextUrl.searchParams.get("catalog")==="1") return Response.json({assets:Object.entries(assets).filter(([,a])=>a.market!=="MAKRO").map(([symbol,a])=>({symbol,name:a.name,market:a.market}))})
 if(request.nextUrl.searchParams.get("news")==="1") {
  const groups=await Promise.all([fetchNews("Borsa Istanbul Turkey economy",6),fetchNews("S&P 500 Nasdaq Federal Reserve markets",6),fetchNews("gold oil markets",4)])
  const seen=new Set<string>()
  const news=groups.flat().filter(item=>{const key=item.url??item.title;if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>(b.publishedAt??"").localeCompare(a.publishedAt??"")).slice(0,12)
  return Response.json({news,source:"Yahoo Finance",topics:["BIST","ABD","Emtia"]})
 }
 try{const {item,meta,candles}=await fetchChart(symbol);const technical=analyzeCandles(candles),previous=candles.at(-2)?.close||meta.chartPreviousClose||technical.price;return Response.json({symbol,name:item.name,market:item.market,currency:meta.currency??"TRY",updatedAt:new Date((meta.regularMarketTime??Date.now()/1000)*1000).toISOString(),price:technical.price,change:previous?((technical.price-previous)/previous)*100:0,technical,advice:horizonAdvice(candles),news:await fetchNews(item.yahoo),analyst:await analystData(item),source:"Yahoo Finance",delayed:true})}catch(error){return Response.json({error:error instanceof Error?error.message:"Piyasa verisi alınamadı",symbol,source:"Yahoo Finance"},{status:502})}
}
export async function POST(request:Request){const body=await request.json().catch(()=>({})),requested=Array.isArray(body.symbols)?body.symbols.slice(0,20):[];const data=await Promise.all(requested.map(async(s:string)=>{const symbol=String(s).toUpperCase();try{const{item,meta,candles}=await fetchChart(symbol,"5d","1d"),price=candles.at(-1)?.close??meta.regularMarketPrice,previous=candles.at(-2)?.close||meta.chartPreviousClose||price;return{symbol,name:item.name,price,change:previous?((price-previous)/previous)*100:0,ok:true}}catch{return{symbol,name:assets[symbol]?.name??symbol,ok:false}}}));return Response.json({data,source:"Yahoo Finance",delayed:true})}
