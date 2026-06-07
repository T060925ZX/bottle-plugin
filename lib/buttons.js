const defaults = {
    style: 1,
    type: 2,
    reply: false,
    enter: true,
    unsupport_tips: '当前客户端不支持此操作'
}

export function commandButton(text, callback, options = {}) {
    return {
        ...defaults,
        text,
        callback,
        ...options
    }
}

export function inputButton(text, callback, prompt, options = {}) {
    return commandButton(text, callback, {
        input: prompt,
        enter: false,
        ...options
    })
}

export const commonButtons = {
    throw: () => inputButton('扔漂流瓶', '#扔漂流瓶 ', '#扔漂流瓶 '),
    pickup: () => commandButton('捡漂流瓶', '#捡漂流瓶'),
    mine: () => commandButton('我的漂流瓶', '#我的漂流瓶'),
    status: () => commandButton('漂流瓶状态', '#漂流瓶状态'),
    help: () => commandButton('使用帮助', '#漂流瓶帮助'),
    comment: bottleId => inputButton('评论', `#评论漂流瓶 ${bottleId} `, '#评论漂流瓶 '),
    comments: bottleId => commandButton('查看评论', `#查看评论 ${bottleId}`),
    reclaim: bottleId => commandButton('捡回', `#捡回漂流瓶 ${bottleId}`),
    rethrow: bottleId => commandButton('重新扔出', `#重新扔漂流瓶 ${bottleId}`)
}
