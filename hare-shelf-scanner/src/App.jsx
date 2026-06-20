import { useState, useRef, useEffect } from "react";

const NDL_API = "https://iss.ndl.go.jp/api/opensearch";
const PROFIT_THRESHOLD = 150;
const RANK_THRESHOLD = 800000;
const PURCHASE_PRICE = 350;
const FEE = 220;
const KEEPA_KEY_STORAGE = "hare_keepa_api_key";

async function fetchKeepa(isbn, apiKey) {
  const ean = isbn.replace(/-/g, "");
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=5&code=${ean}&stats=90`;
  const res = await fetch(url);
  const data = await res.json();
  const product = data.products?.[0];
  if (!product) return null;
  const rank = product.stats?.current?.[3] ?? null;
  const newPrice = product.stats?.current?.[0] !== -1 ? product.stats?.current?.[0] : null;
  const usedPrice = product.stats?.current?.[2] !== -1 ? product.stats?.current?.[2] : null;
  const minPrice = newPrice !== null && usedPrice !== null ? Math.min(newPrice, usedPrice) : (newPrice ?? usedPrice ?? null);
  const sellPrice = minPrice !== null ? Math.round(minPrice / 100) : null;
  const profit = sellPrice !== null ? sellPrice - PURCHASE_PRICE - FEE : null;
  return { rank, sellPrice, profit, asin: product.asin ?? null, title: product.title ?? null };
}

async function searchNDL(title) {
  const url = `${NDL_API}?title=${encodeURIComponent(title)}&mediatype=1&cnt=3`;
  const res = await fetch(url);
  const text = await res.text();
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const items = xml.querySelectorAll("item");
  const results = [];
  for (const item of items) {
    const t = item.querySelector("title")?.textContent || "";
    const author = item.querySelector("author")?.textContent || "";
    const publisher = item.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "publisher")[0]?.textContent || "";
    const identifiers = item.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "identifier");
    let isbn = null;
    for (const id of identifiers) {
      const v = id.textContent.replace(/-/g, "");
      if (/^978\d{10}$/.test(v)) { isbn = v; break; }
    }
    results.push({ title: t, author, publisher, isbn });
  }
  return results;
}

async function extractTitlesFromImage(base64, mimeType) {
  const res = await fetch("/api/extract-titles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, mimeType })
  });
  const data = await res.json();
  return data.titles || [];
}

const STEPS = ["写真アップ", "タイトル確認", "ISBN取得", "利益判定", "結果"];
const green = "#1e4d0f";
const lightGreen = "#e8f5d0";
const yellow = "#f5a623";
const red = "#e05050";

function Dots() {
  const [d, setD] = useState(0);
  useEffect(() => { const t = setInterval(() => setD(v => (v + 1) % 4), 400); return () => clearInterval(t); }, []);
  return <span>{".".repeat(d)}<span style={{ opacity: 0 }}>{".".repeat(3 - d)}</span></span>;
}

function ProcessingOverlay({ message, sub }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const t = setInterval(() => setElapsed(v => v + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 28, textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.10)" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>Loading</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: green, marginBottom: 6 }}>{message}<Dots /></div>
      {sub && <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>{sub}</div>}
      <div style={{ fontSize: 13, color: "#aaa" }}>経過時間: {elapsed}秒</div>
      <div style={{ marginTop: 12, fontSize: 11, color: "#bbb" }}>
        {elapsed < 15 ? "AIが画像を解析しています" :
          elapsed < 30 ? "もう少しかかります..." :
            elapsed < 60 ? "大量のタイトルがある場合は時間がかかります" :
              "時間がかかっています。ネット接続を確認してください"}
      </div>
    </div>
  );
}

export default function HareShelfScanner() {
  const [step, setStep] = useState(0);
  const [keepaKey, setKeepaKey] = useState(() => localStorage.getItem(KEEPA_KEY_STORAGE) || "");
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(!!localStorage.getItem(KEEPA_KEY_STORAGE));
  const [images, setImages] = useState([]);
  const [titles, setTitles] = useState([]);
  const [processingImg, setProcessingImg] = useState(false);
  const [processingImgMsg, setProcessingImgMsg] = useState("");
  const [books, setBooks] = useState([]);
  const [ndlProgress, setNdlProgress] = useState(0);
  const [ndlCurrent, setNdlCurrent] = useState("");
  const [keepaProgress, setKeepaProgress] = useState(0);
  const [activeTab, setActiveTab] = useState("profit");
  const fileRef = useRef();

  function saveKey() {
    localStorage.setItem(KEEPA_KEY_STORAGE, keepaKey);
    setKeySaved(true);
  }
  function clearKey() {
    localStorage.removeItem(KEEPA_KEY_STORAGE);
    setKeepaKey("");
    setKeySaved(false);
  }

  const MAX_EDGE = 1600;
  const JPEG_QUALITY = 0.8;

  async function compressImage(file) {
    const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = dataUrl; });
    let { width, height } = img;
    if (width > MAX_EDGE || height > MAX_EDGE) {
      if (width >= height) { height = Math.round(height * (MAX_EDGE / width)); width = MAX_EDGE; }
      else { width = Math.round(width * (MAX_EDGE / height)); height = MAX_EDGE; }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    const outDataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const base64 = outDataUrl.split(",")[1];
    return { base64, mimeType: "image/jpeg", preview: outDataUrl };
  }

  async function handleImages(files) {
    const arr = [];
    for (const file of files) {
      try {
        const { base64, mimeType, preview } = await compressImage(file);
        arr.push({ file, base64, mimeType, preview });
      } catch {
        const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
        arr.push({ file, base64, mimeType: file.type, preview: URL.createObjectURL(file) });
      }
    }
    setImages(arr);
  }

  async function runExtraction() {
    setProcessingImg(true);
    const all = [];
    for (let i = 0; i < images.length; i++) {
      setProcessingImgMsg(`写真 ${i + 1}/${images.length} を解析中`);
      const t = await extractTitlesFromImage(images[i].base64, images[i].mimeType);
      all.push(...t);
    }
    setTitles([...new Set(all)]);
    setProcessingImg(false);
    setStep(1);
  }

  async function runNDL() {
    setStep(2);
    const result = [];
    for (let i = 0; i < titles.length; i++) {
      const title = titles[i];
      setNdlProgress(Math.round(((i + 1) / titles.length) * 100));
      setNdlCurrent(title);
      const hits = await searchNDL(title);
      const best = hits[0] || null;
      result.push({ title, isbn: best?.isbn || null, ndlTitle: best?.title || null, author: best?.author || null, publisher: best?.publisher || null, keepa: null, status: "pending" });
      await new Promise(r => setTimeout(r, 400));
    }
    setBooks(result);
    setStep(3);
    await runKeepa(result);
  }

  async function runKeepa(bookList) {
    if (!keepaKey) { setStep(4); return; }
    const updated = [...bookList];
    const withIsbn = updated.filter(b => b.isbn);
    for (let i = 0; i < withIsbn.length; i++) {
      setKeepaProgress(Math.round(((i + 1) / withIsbn.length) * 100));
      const b = withIsbn[i];
      try {
        const k = await fetchKeepa(b.isbn, keepaKey);
        b.keepa = k;
        b.status = k ? (k.rank && k.rank <= RANK_THRESHOLD && k.profit !== null && k.profit >= PROFIT_THRESHOLD ? "profit" : "other") : "no_data";
      } catch { b.status = "error"; }
      await new Promise(r => setTimeout(r, 300));
    }
    updated.filter(b => !b.isbn).forEach(b => { b.status = "no_isbn"; });
    setBooks([...updated]);
    setStep(4);
  }

  function exportCSV(list, filename) {
    const header = ["タイトル", "正式タイトル", "著者", "出版社", "ISBN", "ASIN", "ランク", "売価", "利益", "AmazonURL"];
    const rows = list.map(b => {
      const k = b.keepa;
      const amzUrl = k?.asin ? `https://www.amazon.co.jp/dp/${k.asin}` : b.isbn ? `https://www.amazon.co.jp/s?k=${b.isbn}&i=stripbooks` : "";
      return [b.title, b.ndlTitle || "", b.author || "", b.publisher || "", b.isbn || "", k?.asin || "", k?.rank ?? "", k?.sellPrice ?? "", k?.profit ?? "", amzUrl];
    });
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }));
    a.download = filename; a.click();
  }

  const profitBooks = books.filter(b => b.status === "profit");
  const otherBooks = books.filter(b => b.status !== "profit");

  return (
    <div style={{ fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", background: "#f7f5f0", minHeight: "100vh", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ background: green, color: "#fff", padding: "16px 16px 12px" }}>
        <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.6 }}>本せどり ハレ</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>本棚スキャナー</div>
        <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 4, borderRadius: 2, background: i <= step ? "#8ec63f" : "rgba(255,255,255,0.2)", transition: "background 0.4s" }} />
              <div style={{ fontSize: 8, marginTop: 3, opacity: i <= step ? 1 : 0.4, lineHeight: 1.2 }}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ background: "#fff", borderRadius: 10, padding: 14, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: green, marginBottom: 6 }}>
            Keepa APIキー
            {keySaved && <span style={{ marginLeft: 8, background: lightGreen, color: green, fontSize: 10, padding: "2px 6px", borderRadius: 4 }}>保存済み</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type={showKey ? "text" : "password"} value={keepaKey} onChange={e => { setKeepaKey(e.target.value); setKeySaved(false); }}
              placeholder="APIキーを入力（省略可）"
              style={{ flex: 1, border: "1.5px solid #ddd", borderRadius: 7, padding: "8px 10px", fontSize: 13, outline: "none" }} />
            <button onClick={() => setShowKey(!showKey)} style={{ background: "#eee", border: "none", borderRadius: 7, padding: "0 10px", cursor: "pointer", fontSize: 12 }}>
              {showKey ? "隠す" : "表示"}
            </button>
            {!keySaved && keepaKey && (
              <button onClick={saveKey} style={{ background: green, color: "#fff", border: "none", borderRadius: 7, padding: "0 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>保存</button>
            )}
            {keySaved && (
              <button onClick={clearKey} style={{ background: "#fee", color: red, border: "none", borderRadius: 7, padding: "0 10px", cursor: "pointer", fontSize: 12 }}>削除</button>
            )}
          </div>
          {!keepaKey && <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>未入力の場合はISBN取得まで行います</div>}
        </div>

        {step === 0 && (
          <div>
            {!processingImg ? (
              <>
                <div onClick={() => fileRef.current.click()}
                  style={{ background: "#fff", border: `2px dashed ${green}`, borderRadius: 12, padding: "32px 16px", textAlign: "center", cursor: "pointer", marginBottom: 14 }}>
                  <div style={{ fontSize: 40 }}>写真</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: green, marginTop: 8 }}>本棚の写真を選択</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>複数枚まとめて選択できます</div>
                  <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => handleImages(Array.from(e.target.files))} />
                </div>
                {images.length > 0 && (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                      {images.map((img, i) => <img key={i} src={img.preview} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8 }} />)}
                    </div>
                    <div style={{ fontSize: 13, color: green, fontWeight: 700, marginBottom: 10 }}>{images.length}枚選択済み</div>
                    <button onClick={runExtraction}
                      style={{ width: "100%", background: green, color: "#fff", border: "none", borderRadius: 10, padding: 14, fontSize: 16, fontWeight: 800, cursor: "pointer" }}>
                      タイトルを読み取る
                    </button>
                  </>
                )}
              </>
            ) : (
              <ProcessingOverlay message={processingImgMsg || "タイトルを読み取り中"} sub="AIが本の背表紙を解析しています" />
            )}
          </div>
        )}

        {step === 1 && (
          <div>
            <div style={{ background: "#fff", borderRadius: 10, padding: 14, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: green, marginBottom: 10 }}>読み取り結果 — {titles.length}冊</div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>タップして編集・削除できます</div>
              {titles.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <input value={t} onChange={e => { const a = [...titles]; a[i] = e.target.value; setTitles(a); }}
                    style={{ flex: 1, border: "1.5px solid #e0d8cc", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
                  <button onClick={() => setTitles(titles.filter((_, j) => j !== i))}
                    style={{ background: "#fee", color: red, border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontWeight: 700 }}>×</button>
                </div>
              ))}
              <button onClick={() => setTitles([...titles, ""])}
                style={{ width: "100%", background: lightGreen, color: green, border: "none", borderRadius: 8, padding: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 4 }}>
                タイトルを追加
              </button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setStep(0)} style={{ flex: 1, background: "#eee", color: "#333", border: "none", borderRadius: 10, padding: 14, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>撮り直す</button>
              <button onClick={runNDL} style={{ flex: 2, background: green, color: "#fff", border: "none", borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 800, cursor: "pointer" }}>ISBN検索</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>検索中</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: green }}>国会図書館でISBN検索中<Dots /></div>
            <div style={{ margin: "16px 0 4px", background: "#eee", borderRadius: 4, height: 10 }}>
              <div style={{ width: `${ndlProgress}%`, background: "#8ec63f", height: 10, borderRadius: 4, transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: green, marginBottom: 4 }}>{ndlProgress}%</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              {ndlCurrent && `「${ndlCurrent}」を検索中`}
            </div>
            <div style={{ fontSize: 11, color: "#bbb", marginTop: 8 }}>{titles.length}冊中 {Math.round(titles.length * ndlProgress / 100)}冊完了</div>
          </div>
        )}

        {step === 3 && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>判定中</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: green }}>Keepaで利益判定中<Dots /></div>
            <div style={{ margin: "16px 0 4px", background: "#eee", borderRadius: 4, height: 10 }}>
              <div style={{ width: `${keepaProgress}%`, background: yellow, height: 10, borderRadius: 4, transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#b07a00", marginBottom: 4 }}>{keepaProgress}%</div>
            <div style={{ fontSize: 11, color: "#bbb", marginTop: 8 }}>判定基準: ランク{RANK_THRESHOLD.toLocaleString()}位以内・利益{PROFIT_THRESHOLD}円以上</div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, background: lightGreen, borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: green }}>{profitBooks.length}</div>
                <div style={{ fontSize: 11, color: green, fontWeight: 700 }}>利益本</div>
              </div>
              <div style={{ flex: 1, background: "#fff", borderRadius: 10, padding: "12px 10px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#888" }}>{otherBooks.length}</div>
                <div style={{ fontSize: 11, color: "#888", fontWeight: 700 }}>その他</div>
              </div>
              <div style={{ flex: 1, background: "#fff", borderRadius: 10, padding: "12px 10px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: green }}>¥{profitBooks.reduce((s, b) => s + (b.keepa?.profit ?? 0), 0).toLocaleString()}</div>
                <div style={{ fontSize: 11, color: "#888", fontWeight: 700 }}>見込み利益</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <button onClick={() => exportCSV(profitBooks, "利益本リスト.csv")}
                style={{ flex: 1, background: green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>利益本CSV</button>
              <button onClick={() => exportCSV(otherBooks, "その他リスト.csv")}
                style={{ flex: 1, background: "#fff", color: "#555", border: "2px solid #ddd", borderRadius: 8, padding: "10px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>その他CSV</button>
              <button onClick={() => { setStep(0); setImages([]); setTitles([]); setBooks([]); }}
                style={{ flex: 1, background: lightGreen, color: green, border: "none", borderRadius: 8, padding: "10px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>最初から</button>
            </div>
            <div style={{ display: "flex", gap: 0, marginBottom: 10, background: "#e0d8cc", borderRadius: 8, padding: 3 }}>
              {[["profit", `利益本 (${profitBooks.length})`], ["other", `その他 (${otherBooks.length})`]].map(([key, label]) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  style={{ flex: 1, background: activeTab === key ? "#fff" : "transparent", border: "none", borderRadius: 6, padding: "8px 4px", fontSize: 13, fontWeight: activeTab === key ? 700 : 400, cursor: "pointer", color: activeTab === key ? green : "#888" }}>
                  {label}
                </button>
              ))}
            </div>
            {(activeTab === "profit" ? profitBooks : otherBooks).map((b, i) => {
              const k = b.keepa;
              const isProfit = b.status === "profit";
              const amzUrl = k?.asin ? `https://www.amazon.co.jp/dp/${k.asin}` : b.isbn ? `https://www.amazon.co.jp/s?k=${b.isbn}&i=stripbooks` : null;
              return (
                <div key={i} style={{ background: "#fff", borderRadius: 10, marginBottom: 10, padding: "12px 14px", borderLeft: `4px solid ${isProfit ? green : "#ddd"}`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>{b.title}</div>
                  {b.ndlTitle && b.ndlTitle !== b.title && <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{b.ndlTitle}</div>}
                  <div style={{ fontSize: 12, color: "#555", lineHeight: 1.8 }}>
                    {b.author && <span style={{ marginRight: 12 }}>{b.author}</span>}
                    {b.publisher && <span>{b.publisher}</span>}
                  </div>
                  {b.isbn && <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace", marginTop: 2 }}>ISBN: {b.isbn}</div>}
                  {k && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {k.rank && <span style={{ background: "#f0f4e8", color: green, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5 }}>ランク {k.rank.toLocaleString()}位</span>}
                      {k.sellPrice && <span style={{ background: "#fff8e0", color: "#b07a00", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5 }}>最安 ¥{k.sellPrice.toLocaleString()}</span>}
                      {k.profit !== null && <span style={{ background: isProfit ? lightGreen : "#fee", color: isProfit ? green : red, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5 }}>利益 ¥{k.profit.toLocaleString()}</span>}
                      {k.asin && <span style={{ background: "#f0f0f0", color: "#555", fontSize: 11, fontFamily: "monospace", padding: "3px 8px", borderRadius: 5 }}>ASIN: {k.asin}</span>}
                    </div>
                  )}
                  {!b.isbn && <div style={{ fontSize: 11, color: "#f0a500", marginTop: 4 }}>ISBNが見つかりませんでした</div>}
                  {amzUrl && <a href={amzUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: green, fontWeight: 700, textDecoration: "none" }}>Amazonで確認</a>}
                </div>
              );
            })}
            {(activeTab === "profit" ? profitBooks : otherBooks).length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#aaa", fontSize: 14 }}>
                {activeTab === "profit" ? "利益本は見つかりませんでした" : "その他の本はありません"}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
