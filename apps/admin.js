import { createBottleAdminLink } from '../lib/web.js'
import { document, fields, heading } from '../lib/markdown.js'
import { sendReply } from '../lib/reply.js'

export class BottleAdmin extends plugin {
    constructor() {
        super({
            name: '漂流瓶-后台管理',
            dsc: '生成漂流瓶审核管理页面登录链接',
            event: 'message',
            priority: 98,
            rule: [
                { reg: '^#?(漂流瓶管理|瓶子管理)$', fnc: 'openAdmin', permission: 'master' }
            ]
        })
    }

    async openAdmin(e) {
        const url = createBottleAdminLink(e.user_id)
        await sendReply(e, document(
            heading('漂流瓶管理后台'),
            fields([
                ['管理地址', url],
                ['有效时间', '5 分钟'],
                ['使用限制', '链接仅可登录一次']
            ]),
            '> 登录后管理会话有效 12 小时，请勿转发链接。'
        ), [{
            text: '打开管理页面',
            link: url,
            style: 1,
            type: 0,
            unsupport_tips: '当前客户端不支持打开链接，请复制上方地址'
        }])
        return true
    }
}
