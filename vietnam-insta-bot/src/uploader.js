// Instagram Graph API でカルーセル投稿
//   1) 各画像: POST /{ig-user-id}/media (image_url, is_carousel_item=true) → 子コンテナID
//   2) POST /{ig-user-id}/media (media_type=CAROUSEL, children, caption) → 親コンテナID
//   3) POST /{ig-user-id}/media_publish (creation_id)
// 注意: Graph API は「公開URLにある JPEG」しか受け付けない。MEDIA_BASE_URL で配信場所を指定する。
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const VERSION = process.env.GRAPH_API_VERSION || "v23.0";
const API = `https://graph.facebook.com/${VERSION}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function creds() {
  const { INSTAGRAM_ACCOUNT_ID: id, PAGE_ACCESS_TOKEN: token } = process.env;
  if (!id || !token) throw new Error("INSTAGRAM_ACCOUNT_ID と PAGE_ACCESS_TOKEN を設定してください");
  return { id, token };
}

async function graph(method, p, params, { dry } = {}) {
  if (dry) {
    console.log(`  [dry-run] ${method} /${p}`, JSON.stringify(params).slice(0, 160));
    return { id: `dry_${Math.random().toString(36).slice(2, 8)}` };
  }
  const { token } = creds();
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET" ? await fetch(`${API}/${p}?${body}`) : await fetch(`${API}/${p}`, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = new Error(`${method} /${p}: ${JSON.stringify(json.error || json)}`);
    e.transient = res.status >= 500 || json.error?.is_transient;
    throw e;
  }
  return json;
}

/** 一時的エラーのみ再試行 */
async function withRetry(fn, label, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!e.transient || i >= tries - 1) throw e;
      console.warn(`  [upload] ${label} 一時エラー、${2 ** i * 3}s 後に再試行`);
      await sleep(2 ** i * 3000);
    }
  }
}

/** コンテナが FINISHED になるまで待つ（画像取得・処理に数秒〜数十秒かかる） */
async function waitReady(containerId, label, { dry } = {}) {
  if (dry) return;
  for (let i = 0; i < 60; i++) {
    const { status_code } = await graph("GET", containerId, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`${label} のコンテナが ${status_code}`);
    await sleep(5000);
  }
  throw new Error(`${label} のコンテナが5分たっても準備完了になりません`);
}

/** キャプション文字列を組み立てる（上限 2200 字・ハッシュタグ 30 個） */
function buildCaption(caption, { source, reel = false } = {}) {
  const tags = [...new Set(caption.hashtags || [])].slice(0, 30).join(" ");
  const src = source?.name ? `\n\n📰 出典：${source.name}${source.date ? `（${source.date}）` : ""}\n${source.url}\n※ 記事を学習用に要約・再構成したものです` : "";
  const body = reel
    ? `${caption.hook}\n\n🔊 ネイティブ音声つき。全訳・語彙・構文解説は同じ日のカルーセル投稿で👆`
    : `${caption.hook}\n\n${caption.summary}\n\n🔖 保存して何度も復習しよう`;
  return [...`${body}${src}\n\n${tags}`].slice(0, 2200).join("");
}

/**
 * カルーセル投稿
 * @param imageUrls 公開URL（JPEG）2〜10件
 * @returns {{ mediaId: string, permalink?: string, children: string[] }}
 */
async function publishCarousel(imageUrls, caption, { dry = process.env.DRY_RUN === "true", source } = {}) {
  if (imageUrls.length < 2 || imageUrls.length > 10) throw new Error(`カルーセルは 2〜10 枚（現在 ${imageUrls.length} 枚）`);
  const id = dry ? "IG_USER" : creds().id;

  // 1) 子コンテナ
  const children = [];
  for (const [i, url] of imageUrls.entries()) {
    const { id: cid } = await withRetry(
      () => graph("POST", `${id}/media`, { image_url: url, is_carousel_item: "true" }, { dry }),
      `item ${i + 1}`,
    );
    console.log(`  [upload] item ${i + 1}/${imageUrls.length}: ${cid}`);
    children.push(cid);
  }
  for (const [i, cid] of children.entries()) await waitReady(cid, `item ${i + 1}`, { dry });

  // 2) カルーセル親コンテナ
  const { id: carouselId } = await withRetry(
    () => graph("POST", `${id}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: buildCaption(caption, { source }) }, { dry }),
    "carousel",
  );
  await waitReady(carouselId, "carousel", { dry });

  // 3) 公開
  const { id: mediaId } = await withRetry(() => graph("POST", `${id}/media_publish`, { creation_id: carouselId }, { dry }), "publish");
  let permalink;
  if (!dry) ({ permalink } = await graph("GET", mediaId, { fields: "permalink" }).catch(() => ({})));
  console.log(`  [upload] 公開しました: ${mediaId}${permalink ? ` ${permalink}` : ""}`);
  return { mediaId, permalink, children };
}

/** リール投稿（動画の処理に時間がかかるので waitReady で待つ） */
async function publishReel(videoUrl, caption, { dry = process.env.DRY_RUN === "true", source } = {}) {
  const id = dry ? "IG_USER" : creds().id;
  const { id: cid } = await withRetry(
    () => graph("POST", `${id}/media`, { media_type: "REELS", video_url: videoUrl, caption: buildCaption(caption, { source, reel: true }), share_to_feed: "true" }, { dry }),
    "reel",
  );
  await waitReady(cid, "reel", { dry });
  const { id: mediaId } = await withRetry(() => graph("POST", `${id}/media_publish`, { creation_id: cid }, { dry }), "reel publish");
  let permalink;
  if (!dry) ({ permalink } = await graph("GET", mediaId, { fields: "permalink" }).catch(() => ({})));
  console.log(`  [upload] リールを公開しました: ${mediaId}${permalink ? ` ${permalink}` : ""}`);
  return { mediaId, permalink };
}

/** 投稿のインサイト（学習ログ用）。権限がなければ null */
async function getInsights(mediaId, metric = "reach,saved,shares,likes,comments,total_interactions") {
  try {
    const { data } = await graph("GET", `${mediaId}/insights`, { metric });
    return Object.fromEntries(data.map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
  } catch (e) {
    console.warn(`  [insights] ${mediaId}: ${e.message.slice(0, 160)}`);
    return null;
  }
}

/** 認証確認 */
async function check() {
  const { id } = creds();
  const me = await graph("GET", id, { fields: "username,followers_count,media_count" });
  console.log(`OK: @${me.username} · followers ${me.followers_count} · posts ${me.media_count}`);
  const lim = await graph("GET", `${id}/content_publishing_limit`, { fields: "quota_usage,config" });
  console.log("publishing quota:", JSON.stringify(lim.data?.[0] || lim));
}

module.exports = { publishCarousel, publishReel, buildCaption, getInsights, check };

if (require.main === module) {
  if (process.argv[2] === "check") check().catch((e) => { console.error(e.message); process.exit(1); });
  else console.log("Usage: node src/uploader.js check");
}
