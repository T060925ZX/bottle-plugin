import { bottleAdminUrl } from '../lib/web.js'
import { loadConfig } from '../lib/config.js'
import { document, fields, heading } from '../lib/markdown.js'
import { sendReply } from '../lib/reply.js'

export class BottleAdmin extends plugin {
    constructor() {
        super({
            name: '漂流瓶-后台管理',
            dsc: '打开漂流瓶审核管理页面',
            event: 'message',
            priority: 98,
            rule: [
                { reg: '^#?(漂流瓶管理|瓶子管理)$', fnc: 'openAdmin', permission: 'master' }
            ]
        })
    }

    async openAdmin(e) {
        const url = bottleAdminUrl()
        const config = loadConfig()
        await sendReply(e, document(
            heading('漂流瓶管理后台'),
            fields([
                ['管理地址', url],
                ['登录方式', '使用配置中的 web.password'],
                ['登录保持', `${config.web.sessionDays} 天`]
            ]),
            '> 浏览器会保存签名登录凭据，机器人重启后仍然有效。'
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
