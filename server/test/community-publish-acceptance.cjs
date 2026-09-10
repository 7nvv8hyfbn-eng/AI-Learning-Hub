// 仅在本任务隔离数据库运行；正文、账号和上传文件均为合成验收数据。
const assert = require('node:assert/strict'), fs = require('node:fs'), { randomUUID } = require('node:crypto')
const { PrismaClient } = require('/workspace/server/node_modules/@prisma/client')
const sharp = require('/workspace/server/node_modules/sharp')
assert(process.env.COMMUNITY_PUBLISH_ACCEPTANCE === 'true' && new URL(process.env.DATABASE_URL).pathname === '/community_publish' && new URL(process.env.DATABASE_URL).hostname === '127.0.0.1')
const db = new PrismaClient(), checks = [], base = 'http://127.0.0.1:3000/api/v1'
let stage = '', sequence = 0
const input = (text, extra = {}) => ({ type: 'general', contentBlocks: [{ type: 'paragraph', text: `${text} · 验收 ${++sequence}` }], bindings: [], topicIds: [], visibility: 'public', status: 'published', ...extra })
async function api(path, token, method = 'GET', body, key) {
 const response = await fetch(base + path, { method, headers: { origin: process.env[path.startsWith('/admin') ? 'ADMIN_WEB_URL' : 'FRONTEND_URL'], ...(token ? { authorization: 'Bearer '+token } : {}), ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
 const value = await response.json(); return { status: response.status, data: value.data, message: value.message }
}
async function okay(path, token, method, body, key) { const result = await api(path, token, method, body, key); assert(result.status < 300, `${path}: ${result.status} ${result.message}`); return result.data }
const check = async (name, action) => { stage = name; await action(); checks.push(name); console.log('PASS '+name) }
const postInput = post => ({ type: post.type, title: post.title || '', contentBlocks: post.contentBlocks, bindings: [], topicIds: post.manualTopicIds || [], inlineReferences: post.inlineReferences?.map(({ kind, text, id }) => ({ kind, text, id })), quotedPostId: post.quotedPostId, visibility: post.visibility, status: 'published', expectedRevision: post.revision })
async function main() {
 const [a,b,c,unverified] = await Promise.all(['publish_a','publish_b','publish_c','publish_unverified'].map(username => db.user.findUniqueOrThrow({ where: { username } })))
 const login = async user => (await okay('/auth/login', null, 'POST', { identifier: user.email, password: process.env.BROWSER_PASSWORD })).accessToken
 const [at,bt,ct,ut] = await Promise.all([a,b,c,unverified].map(login))
 let admin = await okay('/admin-auth/login', null, 'POST', { identifier: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD })
 if (admin.mfaRequired) { const hint = await okay('/admin-auth/mfa-hint', null, 'POST', { challenge: admin.challenge }); assert(hint.code); admin = await okay('/admin-auth/mfa', null, 'POST', { challenge: admin.challenge, code: hint.code }) }
 const ad = admin.accessToken; assert(ad)
 const create = (token, body, key = randomUUID()) => okay('/community/posts', token, 'POST', body, key)
 const read = (id, token = at) => okay('/community/posts/'+id, token)
 const edit = (post, token, extra) => okay('/community/posts/'+post.id, token, 'PATCH', { ...postInput(post), ...extra }, randomUUID())
 const notificationCount = (id, recipient, type = 'mention') => db.userNotification.count({ where: { entityId: id, recipientId: recipient, notificationType: type } })
 await check('数据库有界搜索覆盖第200项之后，公开用户候选不含实名字段', async () => {
  const topics = await okay('/community/search/suggestions?kind=topic&q='+encodeURIComponent('深度_模型'), at)
  assert(topics.some(row => row.id === 'zz-last-topic')); assert(topics.length <= 8)
  const users = await okay('/community/search/suggestions?kind=mention&q='+encodeURIComponent('提及目标'), at)
  assert.equal(users[0].id,b.id); assert.deepEqual(Object.keys(users[0]).sort(),['avatar','id','kind','name','username','verifiedType'])
  assert.equal((await okay('/community/topics/late-topic',at)).description,'位于默认前200项之后的真实查询目标')
 })
 let draft, pending, published, original, quote, nested, manual
 await check('私人草稿保存稳定提及，不创建公共话题或通知', async () => {
  draft = await okay('/community/drafts', at, 'POST', input('#草稿模型 @publish_b', { status: 'draft' }), randomUUID())
  assert.equal(draft.status,'draft'); assert.equal(draft.inlineReferences.find(ref=>ref.kind==='mention').id,b.id)
  assert.equal(await db.communityTopic.count({where:{normalizedName:'草稿模型'}}),0); assert.equal(await notificationCount(draft.id,b.id),0)
  const restored=(await okay('/community/drafts',at)).find(row=>row.id===draft.id); assert.equal(restored.input.inlineReferences[0].id,b.id)
 })
 await check('待审投稿保留关系，目录与通知仅在审批后出现', async () => {
  pending=await create(at,input('反诈案例：先交保证金再返佣 #待审模型 @publish_b'))
  assert.equal(pending.status,'pending_review'); assert.equal(await db.communityTopic.count({where:{normalizedName:'待审模型'}}),0); assert.equal(await notificationCount(pending.id,b.id),0)
  assert.equal((await api('/community/posts/'+pending.id,ct)).status,404)
  const decision={expectedRevision:pending.revision,ruleVersion:pending.detection.ruleVersion,action:'approve',reason:'合成反诈教学案例已核对'}
  await okay('/admin/community/content-reviews/'+pending.detection.review.id+'/decision',ad,'POST',decision)
  assert.equal(await db.communityTopic.count({where:{normalizedName:'待审模型'}}),1);assert.equal(await notificationCount(pending.id,b.id),1)
  assert.equal((await api('/admin/community/content-reviews/'+pending.detection.review.id+'/decision',ad,'POST',decision)).status,409)
  assert.equal(await notificationCount(pending.id,b.id),1)
 })
 await check('草稿发布及请求重放只发布一次，话题页有真实关联',async()=>{
  const body={...postInput(draft),status:'published'},key=randomUUID()
  published=await okay('/community/posts/'+draft.id,at,'PATCH',body,key)
  const retry=await okay('/community/posts/'+draft.id,at,'PATCH',body,key)
  assert.equal(retry.id,published.id);assert.equal(await notificationCount(published.id,b.id),1)
  const topic=published.topics.find(row=>row.name==='草稿模型');assert(topic)
  assert((await okay('/community/topics/'+topic.slug+'/posts',ct)).some(post=>post.id===published.id))
 })
 await check('正文与手动话题去重，移除正文不误删手动选择',async()=>{
  manual=await create(at,input('#模型部署 @publish_b',{topicIds:['manual-topic','model-topic']}))
  assert.deepEqual(manual.topics.map(row=>row.id).sort(),['manual-topic','model-topic'])
  manual=await edit(manual,at,{contentBlocks:[{type:'paragraph',text:'仅保留手动选择'}]})
  assert.deepEqual(manual.topics.map(row=>row.id).sort(),['manual-topic','model-topic'])
  manual=await edit(manual,at,{topicIds:['manual-topic']});assert.deepEqual(manual.topics.map(row=>row.id),['manual-topic'])
 })
 await check('规范化话题并发合并，非法数量整笔回滚',async()=>{
  await Promise.all([create(at,input('#RebelHeart')),create(ct,input('#rebelheart'))])
  assert.equal(await db.communityTopic.count({where:{normalizedName:'rebelheart'}}),1)
  const before=await db.communityPost.findUniqueOrThrow({where:{id:manual.id}})
  assert.equal((await api('/community/posts/'+manual.id,at,'PATCH',{...postInput(manual),contentBlocks:[{type:'paragraph',text:'#测试一 #测试二 #测试三 #测试四 #测试五 #测试六'}]},randomUUID())).status,400)
  const after=await db.communityPost.findUniqueOrThrow({where:{id:manual.id}});assert.equal(after.revision,before.revision);assert.equal(after.plainText,before.plainText)
  assert.equal(await db.communityTopic.count({where:{normalizedName:{in:['测试一','测试二','测试三','测试四','测试五','测试六']}}}),0)
 })
 await check('手打提及通过ID绑定，改名及旧名复用不会串人',async()=>{
  await okay('/community/profile/username',bt,'PATCH',{username:'publish_b_new'})
  const clone=await db.user.create({data:{username:'publish_b',email:'new-owner@example.invalid',displayName:'旧名的新使用者',passwordHash:b.passwordHash,emailVerifiedAt:new Date(),schoolId:b.schoolId,communityProfile:{create:{}}}})
  published=await edit(published,at,{title:'改名后再保存'})
  const ref=published.inlineReferences.find(row=>row.kind==='mention');assert.equal(ref.id,b.id);assert.equal(ref.route,'/community/people/'+b.id)
  assert.equal(await notificationCount(published.id,clone.id),0);assert.equal((await okay('/community/users/'+ref.id,at)).username,'publish_b_new')
  const fresh=await create(at,input('@publish_b'));assert.equal(fresh.inlineReferences.find(row=>row.kind==='mention').id,clone.id)
  assert.equal((await api('/community/posts',at,'POST',input('@publish_b',{inlineReferences:[{kind:'mention',text:'@publish_b',id:b.id}]}),randomUUID())).status,400)
 })
 await check('代码、链接、邮箱和普通编号不产生实体；富文本跨样式标记可用',async()=>{
  const post=await create(at,input('',{contentBlocks:[{type:'rich_text',text:'<p>#模<strong>型部署</strong> @publish_b_new</p><pre><code>#代码话题 @publish_c</code></pre><a href="https://example.invalid">#链接话题 @publish_c</a><p>test@publish_c.com #123</p>'}]}))
  assert.deepEqual(post.inlineReferences.map(ref=>ref.kind).sort(),['mention','topic']);assert.equal(post.inlineReferences.find(ref=>ref.kind==='mention').id,b.id)
  assert.equal(await notificationCount(post.id,c.id),0)
 })
 await check('同校内容不向公共目录创建新标签，新增提及只通知一次',async()=>{
  let post=await create(at,input('#同校私有标签 @publish_b_new',{visibility:'school'}))
  assert.equal(await db.communityTopic.count({where:{normalizedName:'同校私有标签'}}),0)
  post=await edit(post,at,{contentBlocks:[{type:'paragraph',text:'同校更新 @publish_b_new @publish_c'}]})
  assert.equal(await notificationCount(post.id,b.id),1);assert.equal(await notificationCount(post.id,c.id),1)
  await edit(post,at,{title:'重复保存'});assert.equal(await notificationCount(post.id,c.id),1)
 })
 let foreignFile
 await check('引用保留自己的正文，不复制原作者图片，也不增加原帖浏览量',async()=>{
  const png=await sharp({create:{width:480,height:270,channels:3,background:'#c96035'}}).png().toBuffer(),form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'original.png')
  foreignFile=(await okay('/community/media',bt,'POST',form)).id
  original=await create(bt,input('公开原帖：模型部署的实践经验',{title:'可引用的原帖',contentBlocks:[{type:'paragraph',text:'模型部署应先做小样验证，再记录可复现步骤。'},{type:'image',fileId:foreignFile,alt:'原帖示意图'}]}))
  const before=(await db.communityPost.findUniqueOrThrow({where:{id:original.id}})).impressionCount
  const body=input('我的观点是先验证边界条件',{quotedPostId:original.id}),key=randomUUID();quote=await create(at,body,key)
  assert.equal((await create(at,body,key)).id,quote.id);assert.equal(quote.contentBlocks.length,1);assert.equal(quote.quotedPost.thumbnailFileId,foreignFile)
  assert.equal((await read(original.id)).stats.quotes,1);assert.equal(await notificationCount(quote.id,b.id,'quote'),1)
  assert.equal((await db.communityPost.findUniqueOrThrow({where:{id:original.id}})).impressionCount,before)
  assert((await okay('/community/posts/'+original.id+'/quotes',at)).some(post=>post.id===quote.id))
 })
 await check('引用仍执行图片所有权、自引用、目标不可变及实名资格校验',async()=>{
  assert.equal((await api('/community/posts',at,'POST',input('伪造原作者文件',{quotedPostId:original.id,contentBlocks:[{type:'paragraph',text:'观点'},{type:'image',fileId:foreignFile}]}))).status,400)
  assert.equal((await api('/community/posts/'+quote.id,at,'PATCH',{...postInput(quote),quotedPostId:quote.id})).status,400)
  assert.equal((await api('/community/posts/'+quote.id,at,'PATCH',{...postInput(quote),quotedPostId:published.id})).status,400)
  assert.equal((await api('/community/posts',ut,'POST',input('未认证引用',{quotedPostId:original.id}))).status,403)
  assert.equal((await api('/community/posts',at,'POST',input('',{quotedPostId:original.id,contentBlocks:[]}))).status,400)
 })
 await check('引用嵌套最多一层，草稿不计数或通知',async()=>{
  nested=await create(ct,input('我补充另一个角度',{quotedPostId:quote.id}))
  assert(nested.quotedPost.available);assert.equal(nested.quotedPost.id,quote.id);assert(!('quotedPost' in nested.quotedPost));assert(!('quotedPostId' in nested.quotedPost))
  const draftQuote=await okay('/community/drafts',ct,'POST',input('引用草稿',{status:'draft',quotedPostId:original.id}),randomUUID())
  assert.equal((await read(original.id)).stats.quotes,1);assert.equal(await notificationCount(draftQuote.id,b.id,'quote'),0)
 })
 await check('原帖转同校、下架或作者停用后引用DTO不泄露原文和图片',async()=>{
  original=await edit(original,bt,{visibility:'school'})
  assert.deepEqual((await read(quote.id)).quotedPost,{id:original.id,available:false})
  assert.equal((await api('/community/posts',ct,'POST',input('同校也不能引用',{quotedPostId:original.id}))).status,400)
  original=await edit(original,bt,{visibility:'public'})
  await db.user.update({where:{id:b.id},data:{status:'disabled'}})
  assert.deepEqual((await read(quote.id)).quotedPost,{id:original.id,available:false})
  await db.user.update({where:{id:b.id},data:{status:'active'}})
  await okay('/community/posts/'+original.id+'/unpublish',bt,'POST',{})
  assert.deepEqual((await read(quote.id)).quotedPost,{id:original.id,available:false})
  const originalDraft=await read(original.id,bt)
  assert.equal((await api('/community/posts/'+original.id,bt,'PATCH',{...postInput(originalDraft),quotedPostId:published.id})).status,400)
  original=await edit(originalDraft,bt,{status:'published'})
 })
 await check('后台能识别引用对象，私人草稿继续不可读',async()=>{
  const detail=await okay('/admin/community/posts/'+quote.id,ad);assert.equal(detail.post.quotedPostId,original.id);assert(detail.post.quotedPost.available)
  const privatePost=await okay('/community/drafts',at,'POST',input('私人草稿',{status:'draft'}),randomUUID())
  assert((await api('/admin/community/posts/'+privatePost.id,ad)).status>=400)
 })
 await check('视频和资料的未完成草稿可保存，缺文件时不能发布',async()=>{
  for(const kind of ['video','document']) {
   const body=input('',{status:'draft',title:'',contentBlocks:[],contribution:{kind,tags:[],teachingReuseConsent:false}})
   const saved=await okay('/community/drafts',at,'POST',body,randomUUID());assert.equal(saved.contribution.kind,kind)
   assert.equal((await api('/community/posts/'+saved.id,at,'PATCH',{...body,title:'待上传文件',status:'published',expectedRevision:saved.revision})).status,400)
  }
 })
 await check('通知没有复制正文，原帖删除后历史引用使用占位',async()=>{
  const rows=await db.userNotification.findMany({where:{entityId:quote.id,notificationType:'quote'}});assert.equal(rows.length,1);assert(!JSON.stringify(rows[0].payload).includes('我的观点'))
  await okay('/community/posts/'+original.id,bt,'DELETE');const shown=await read(quote.id);assert.equal(shown.id,quote.id);assert.deepEqual(shown.quotedPost,{id:original.id,available:false})
  assert(shown.contentBlocks[0].text.includes('我的观点'))
 })
 const refs={ownerId:a.id,recipientId:b.id,quoteId:quote.id,nestedId:nested.id,publishedId:published.id,unavailableOriginalId:original.id}
 fs.writeFileSync('/tmp/community-publish-acceptance.json',JSON.stringify({passed:true,checks,refs},null,2))
 await db.$disconnect();console.log(JSON.stringify({passed:true,checks:checks.length,refs}))
}
main().catch(async error=>{fs.writeFileSync('/tmp/community-publish-acceptance.json',JSON.stringify({passed:false,stage,checks,error:error.message},null,2));console.error('ACCEPTANCE_FAILED '+stage+': '+error.message);await db.$disconnect();process.exit(1)})
