const { createApp } = Vue

createApp({
    data() {
        return {
            authenticated: false,
            checking: true,
            login: { password: '', error: '', loading: false },
            publicConfig: { passwordConfigured: true, sessionDays: 30, pageSize: 20 },
            page: 'overview',
            stats: null,
            bottles: { rows: [], page: 1, pages: 1, total: 0 },
            comments: { rows: [], page: 1, pages: 1, total: 0 },
            bottleFilter: { keyword: '', status: '', location: '' },
            commentFilter: { keyword: '', status: '' },
            detail: null,
            dialog: null,
            toastText: ''
        }
    },
    computed: {
        pageTitle() {
            return {
                overview: ['概览', '审核状态与内容规模一目了然。'],
                bottles: ['漂流瓶', '搜索、审核和管理全部漂流瓶。'],
                comments: ['评论', '独立处理评论审核，避免遗漏。']
            }[this.page]
        }
    },
    async mounted() {
        try {
            this.publicConfig = await this.api('/bottle/api/public-config', {}, false)
            await this.api('/bottle/api/session')
            this.authenticated = true
            await this.refreshAll()
        } catch {
            this.authenticated = false
        } finally {
            this.checking = false
        }
    },
    methods: {
        async api(url, options = {}, requireAuth = true) {
            const response = await fetch(url, {
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                ...options
            })
            const data = await response.json().catch(() => ({}))
            if (response.status === 401 && requireAuth) this.authenticated = false
            if (!response.ok || data.ok === false) throw new Error(data.message || '请求失败')
            return data.data ?? data
        },
        async submitLogin() {
            this.login.loading = true
            this.login.error = ''
            try {
                await this.api('/bottle/api/login', {
                    method: 'POST',
                    body: JSON.stringify({ password: this.login.password })
                }, false)
                this.authenticated = true
                this.login.password = ''
                await this.refreshAll()
            } catch (error) {
                this.login.error = error.message
            } finally {
                this.login.loading = false
            }
        },
        async logout() {
            await this.api('/bottle/api/logout', { method: 'POST' })
            this.authenticated = false
        },
        async refreshAll() {
            await Promise.all([this.loadStats(), this.loadBottles(), this.loadComments()])
        },
        async loadStats() {
            this.stats = await this.api('/bottle/api/stats')
        },
        query(filters, page) {
            return new URLSearchParams({
                ...filters,
                page,
                pageSize: this.publicConfig.pageSize || 20
            })
        },
        async loadBottles(page = this.bottles.page) {
            this.bottles = await this.api(`/bottle/api/bottles?${this.query(this.bottleFilter, page)}`)
        },
        async loadComments(page = this.comments.page) {
            this.comments = await this.api(`/bottle/api/comments?${this.query(this.commentFilter, page)}`)
        },
        async openDetail(id) {
            this.detail = await this.api(`/bottle/api/bottles/${id}`)
        },
        toast(message) {
            this.toastText = message
            clearTimeout(this.toastTimer)
            this.toastTimer = setTimeout(() => { this.toastText = '' }, 2400)
        },
        requestModeration(kind, id, status) {
            if (status === 'rejected') {
                this.dialog = { kind, id, status, reason: '' }
                return
            }
            this.applyModeration(kind, id, status, '人工审核通过')
        },
        async applyModeration(kind, id, status, reason) {
            const url = kind === 'bottle'
                ? `/bottle/api/bottles/${id}`
                : `/bottle/api/comments/${id}`
            try {
                await this.api(url, {
                    method: 'PATCH',
                    body: JSON.stringify({ status, reason })
                })
                this.dialog = null
                this.toast(status === 'approved' ? '审核已通过' : '已记录拒绝原因')
                await this.refreshAll()
                if (this.detail) await this.openDetail(this.detail.id)
            } catch (error) {
                this.toast(error.message)
            }
        },
        submitReject() {
            const reason = String(this.dialog.reason || '').trim()
            if (!reason) {
                this.toast('请填写未通过原因')
                return
            }
            this.applyModeration(this.dialog.kind, this.dialog.id, 'rejected', reason)
        },
        async updateLocation(id, location) {
            try {
                await this.api(`/bottle/api/bottles/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ location })
                })
                this.toast('位置已更新')
                await Promise.all([this.loadStats(), this.loadBottles()])
                if (this.detail) await this.openDetail(id)
            } catch (error) {
                this.toast(error.message)
            }
        },
        async removeBottle(id) {
            if (!confirm(`确定永久删除漂流瓶 ${id} 吗？`)) return
            await this.api(`/bottle/api/bottles/${id}`, { method: 'DELETE' })
            this.detail = null
            this.toast('漂流瓶已删除')
            await this.refreshAll()
        },
        async removeComment(id) {
            if (!confirm('确定永久删除这条评论吗？')) return
            await this.api(`/bottle/api/comments/${id}`, { method: 'DELETE' })
            this.toast('评论已删除')
            await this.refreshAll()
            if (this.detail) await this.openDetail(this.detail.id)
        },
        statusLabel(value) {
            return { pending: '待审核', approved: '已通过', rejected: '未通过' }[value] || value
        },
        locationLabel(value) {
            return value === 'sea' ? '海中' : '已收回'
        },
        formatTime(value) {
            return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
        },
        short(value, length = 80) {
            const text = String(value || '')
            return text.length > length ? `${text.slice(0, length)}...` : text
        }
    },
    template: `
        <div v-if="checking" class="boot">正在验证管理会话...</div>

        <main v-else-if="!authenticated" class="login-page">
            <form class="login-card" @submit.prevent="submitLogin">
                <div class="mark">B</div>
                <h1>漂流瓶管理</h1>
                <p>使用独立管理密码登录。登录状态会在当前浏览器保留 {{ publicConfig.sessionDays }} 天。</p>
                <div class="field">
                    <label for="password">管理密码</label>
                    <input id="password" v-model="login.password" class="control" type="password"
                        autocomplete="current-password" placeholder="输入 web.password" autofocus>
                </div>
                <div v-if="!publicConfig.passwordConfigured" class="error">尚未配置 web.password，请先在锅巴或配置文件中设置。</div>
                <div v-if="login.error" class="error">{{ login.error }}</div>
                <button class="button primary full" :disabled="login.loading || !login.password">
                    {{ login.loading ? '登录中...' : '登录管理台' }}
                </button>
            </form>
        </main>

        <div v-else class="layout">
            <aside class="sidebar">
                <div class="brand"><span class="mark">B</span><span>Bottle Console</span></div>
                <nav class="nav">
                    <button :class="{ active: page === 'overview' }" @click="page = 'overview'"><span class="nav-icon">01</span>概览</button>
                    <button :class="{ active: page === 'bottles' }" @click="page = 'bottles'"><span class="nav-icon">02</span>漂流瓶</button>
                    <button :class="{ active: page === 'comments' }" @click="page = 'comments'"><span class="nav-icon">03</span>评论</button>
                </nav>
                <div class="sidebar-foot"><button class="button full" @click="logout">退出登录</button></div>
            </aside>

            <main class="main">
                <header class="topbar">
                    <div><h1>{{ pageTitle[0] }}</h1><p>{{ pageTitle[1] }}</p></div>
                    <div class="actions">
                        <button class="button" @click="refreshAll().then(() => toast('数据已刷新'))">刷新</button>
                        <button class="button" @click="logout">退出</button>
                    </div>
                </header>

                <section v-if="page === 'overview' && stats">
                    <div class="metrics">
                        <article class="metric"><div class="metric-label">全部漂流瓶</div><div class="metric-value">{{ stats.bottles.total }}</div><div class="metric-note">{{ stats.bottles.sea }} 个仍在海中</div></article>
                        <article class="metric"><div class="metric-label">待审漂流瓶</div><div class="metric-value">{{ stats.bottles.pending }}</div><div class="metric-note">需要人工确认</div></article>
                        <article class="metric"><div class="metric-label">未通过漂流瓶</div><div class="metric-value">{{ stats.bottles.rejected }}</div><div class="metric-note">均可查看具体原因</div></article>
                        <article class="metric"><div class="metric-label">待审评论</div><div class="metric-value">{{ stats.comments.pending }}</div><div class="metric-note">评论总数 {{ stats.comments.total }}</div></article>
                    </div>
                    <div class="flow">
                        <article><div class="kicker develop">DEVELOP</div><strong>自动审核</strong><p>OpenAI 与 Gemini 统一输出审核状态和原因。</p></article>
                        <article><div class="kicker preview">PREVIEW</div><strong>人工复核</strong><p>待审内容集中呈现，拒绝时必须填写原因。</p></article>
                        <article><div class="kicker ship">SHIP</div><strong>发布入海</strong><p>只有通过审核的漂流瓶才计入每日额度。</p></article>
                    </div>
                </section>

                <section v-if="page === 'bottles'">
                    <form class="toolbar" @submit.prevent="loadBottles(1)">
                        <input class="control" v-model="bottleFilter.keyword" placeholder="搜索 ID、内容、用户或审核原因">
                        <select class="control" v-model="bottleFilter.status">
                            <option value="">全部状态</option><option value="pending">待审核</option>
                            <option value="approved">已通过</option><option value="rejected">未通过</option>
                        </select>
                        <select class="control" v-model="bottleFilter.location">
                            <option value="">全部位置</option><option value="sea">海中</option><option value="home">已收回</option>
                        </select>
                        <button class="button primary">查询</button>
                    </form>
                    <div class="table-card">
                        <div class="table-wrap"><table>
                            <thead><tr><th>ID / 用户</th><th>内容 / 原因</th><th>状态</th><th>数据</th><th>时间</th><th>操作</th></tr></thead>
                            <tbody><tr v-for="item in bottles.rows" :key="item.id">
                                <td><button class="id-link" @click="openDetail(item.id)">{{ item.id }}</button><div>{{ item.throwerName }}</div><div class="muted mono">{{ item.thrower }}</div></td>
                                <td><div class="content">{{ short(item.content) }}</div><div v-if="item.moderationReason" class="reason">原因：{{ item.moderationReason }}</div></td>
                                <td><span class="badge" :class="item.status">{{ statusLabel(item.status) }}</span> <span class="badge" :class="item.location">{{ locationLabel(item.location) }}</span></td>
                                <td>捡取 {{ item.pickupCount }}<div class="muted">评论 {{ item.commentCount }} · 待审 {{ item.pendingCommentCount }}</div></td>
                                <td class="muted">{{ formatTime(item.throwTime) }}</td>
                                <td><div class="row-actions">
                                    <button class="button small" @click="openDetail(item.id)">详情</button>
                                    <button class="button small" @click="requestModeration('bottle', item.id, 'approved')">通过</button>
                                    <button class="button small" @click="requestModeration('bottle', item.id, 'rejected')">拒绝</button>
                                </div></td>
                            </tr></tbody>
                        </table></div>
                        <div v-if="!bottles.rows.length" class="empty">没有符合条件的漂流瓶</div>
                        <div class="pagination"><span class="muted">共 {{ bottles.total }} 个 · 第 {{ bottles.page }} / {{ bottles.pages }} 页</span><div class="pager">
                            <button class="button small" :disabled="bottles.page <= 1" @click="loadBottles(1)">首页</button>
                            <button class="button small" :disabled="bottles.page <= 1" @click="loadBottles(bottles.page - 1)">上一页</button>
                            <button class="button small" :disabled="bottles.page >= bottles.pages" @click="loadBottles(bottles.page + 1)">下一页</button>
                            <button class="button small" :disabled="bottles.page >= bottles.pages" @click="loadBottles(bottles.pages)">末页</button>
                        </div></div>
                    </div>
                </section>

                <section v-if="page === 'comments'">
                    <form class="toolbar" @submit.prevent="loadComments(1)">
                        <input class="control" v-model="commentFilter.keyword" placeholder="搜索评论、瓶子 ID、用户或审核原因">
                        <select class="control" v-model="commentFilter.status">
                            <option value="">全部状态</option><option value="pending">待审核</option>
                            <option value="approved">已通过</option><option value="rejected">未通过</option>
                        </select>
                        <span></span><button class="button primary">查询</button>
                    </form>
                    <div class="table-card">
                        <div class="table-wrap"><table>
                            <thead><tr><th>瓶子 / 评论人</th><th>评论 / 原因</th><th>瓶子内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
                            <tbody><tr v-for="item in comments.rows" :key="item.id">
                                <td><button class="id-link" @click="openDetail(item.bottleId)">{{ item.bottleId }}</button><div>{{ item.userName }}</div><div class="muted mono">{{ item.userId }}</div></td>
                                <td><div class="content">{{ item.content }}</div><div v-if="item.moderationReason" class="reason">原因：{{ item.moderationReason }}</div></td>
                                <td class="muted">{{ short(item.bottleContent, 45) }}</td>
                                <td><span class="badge" :class="item.status">{{ statusLabel(item.status) }}</span></td>
                                <td class="muted">{{ formatTime(item.time) }}</td>
                                <td><div class="row-actions">
                                    <button class="button small" @click="requestModeration('comment', item.id, 'approved')">通过</button>
                                    <button class="button small" @click="requestModeration('comment', item.id, 'rejected')">拒绝</button>
                                    <button class="button small" @click="removeComment(item.id)">删除</button>
                                </div></td>
                            </tr></tbody>
                        </table></div>
                        <div v-if="!comments.rows.length" class="empty">没有符合条件的评论</div>
                        <div class="pagination"><span class="muted">共 {{ comments.total }} 条 · 第 {{ comments.page }} / {{ comments.pages }} 页</span><div class="pager">
                            <button class="button small" :disabled="comments.page <= 1" @click="loadComments(1)">首页</button>
                            <button class="button small" :disabled="comments.page <= 1" @click="loadComments(comments.page - 1)">上一页</button>
                            <button class="button small" :disabled="comments.page >= comments.pages" @click="loadComments(comments.page + 1)">下一页</button>
                            <button class="button small" :disabled="comments.page >= comments.pages" @click="loadComments(comments.pages)">末页</button>
                        </div></div>
                    </div>
                </section>
            </main>

            <div v-if="detail" class="overlay" @click.self="detail = null">
                <aside class="drawer">
                    <div class="drawer-head"><div><div class="kicker">BOTTLE DETAIL</div><h2>漂流瓶 {{ detail.id }}</h2></div><button class="button" @click="detail = null">关闭</button></div>
                    <div class="detail-content">{{ detail.content }}</div>
                    <div v-if="detail.moderationReason" class="reason">审核原因：{{ detail.moderationReason }}</div>
                    <div class="detail-meta">
                        <div><span class="muted">扔出者</span><br>{{ detail.throwerName }} <span class="mono muted">{{ detail.thrower }}</span></div>
                        <div><span class="muted">时间</span><br>{{ formatTime(detail.throwTime) }}</div>
                        <div><span class="muted">状态</span><br><span class="badge" :class="detail.status">{{ statusLabel(detail.status) }}</span></div>
                        <div><span class="muted">位置</span><br><span class="badge" :class="detail.location">{{ locationLabel(detail.location) }}</span></div>
                    </div>
                    <div class="section row-actions">
                        <button class="button" @click="requestModeration('bottle', detail.id, 'approved')">审核通过</button>
                        <button class="button" @click="requestModeration('bottle', detail.id, 'rejected')">审核拒绝</button>
                        <button class="button" @click="updateLocation(detail.id, detail.location === 'sea' ? 'home' : 'sea')">{{ detail.location === 'sea' ? '收回' : '重新投放' }}</button>
                        <button class="button danger" @click="removeBottle(detail.id)">永久删除</button>
                    </div>
                    <section class="section"><h3>最新评论（{{ detail.comments.length }}）</h3>
                        <article v-for="comment in detail.comments" :key="comment.id" class="record">
                            <div class="record-head"><strong>{{ comment.userName }}</strong><span class="badge" :class="comment.status">{{ statusLabel(comment.status) }}</span></div>
                            <div>{{ comment.content }}</div><div v-if="comment.moderationReason" class="reason">原因：{{ comment.moderationReason }}</div>
                            <div class="muted">{{ formatTime(comment.time) }} · {{ comment.userId }}</div>
                            <div class="row-actions">
                                <button class="button small" @click="requestModeration('comment', comment.id, 'approved')">通过</button>
                                <button class="button small" @click="requestModeration('comment', comment.id, 'rejected')">拒绝</button>
                                <button class="button small" @click="removeComment(comment.id)">删除</button>
                            </div>
                        </article>
                        <p v-if="!detail.comments.length" class="muted">暂无评论</p>
                    </section>
                    <section class="section"><h3>最近捡取记录（{{ detail.pickupRecords.length }}）</h3>
                        <article v-for="record in detail.pickupRecords" :key="record.id" class="record">
                            <strong>{{ record.userName }}</strong>
                            <div class="muted">{{ record.userId }} · {{ formatTime(record.time) }}</div>
                        </article>
                        <p v-if="!detail.pickupRecords.length" class="muted">暂无捡取记录</p>
                    </section>
                </aside>
            </div>
        </div>

        <div v-if="dialog" class="dialog-wrap">
            <form class="dialog" @submit.prevent="submitReject">
                <h2>填写未通过原因</h2>
                <p>原因会保存在审核记录中，并展示在管理页面。</p>
                <textarea class="control" v-model="dialog.reason" maxlength="200" placeholder="例如：包含联系方式或广告引流" autofocus></textarea>
                <div class="dialog-actions"><button type="button" class="button" @click="dialog = null">取消</button><button class="button danger">确认拒绝</button></div>
            </form>
        </div>
        <div v-if="toastText" class="toast">{{ toastText }}</div>
    `
}).mount('#app')
