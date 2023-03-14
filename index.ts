import { WebsocketDemo } from "./WebsocketDemo";

let ws = new WebsocketDemo()
ws.on('data', (payload) => {
    console.log(`recive data:${payload}`)

    if(payload == 'ping')
        ws.send(`pong`)
})
