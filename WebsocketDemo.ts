import crypto from 'crypto'
import { EventEmitter } from 'events';
import http from 'http';
import * as stream from 'node:stream';

//固定的握手字符串
const FIXED_KEY_STR = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
function hashKey(key:string): string
{
    const sha1 = crypto.createHash('sha1');
    sha1.update(key + FIXED_KEY_STR)

    return sha1.digest('base64')
}

//按位异或解码（这玩意真的脑袋有坑，自欺欺人加密）
function decodeMask(maskKey, data)
{
    const payload = Buffer.alloc(data.length);
    for(let i = 0; i < data.length; ++ i)
    {
        payload[i] = maskKey[i % 4] ^ data[i]
    }

    return payload
}

export const OPCODES = {
    CONTINUE: 0,
    TEXT: 1, // 文本
    BINARY: 2, // 二进制
    CLOSE: 8,
    PING: 9,
    PONG: 10,
};

//有 on_xxx 的能力
export class WebsocketDemo extends EventEmitter
{
    private socket: stream.Duplex;
    
    constructor(option?){
        super(option);

        const server = http.createServer();
        server.listen(8080);

        //收到upgrade之后，切换自己的ws协议
        server.on('upgrade', (req, socket:stream.Duplex)=>{
            this.socket = socket
            
            const resHeaders = [
                'HTTP/1.1 101 Switching Protocols',
                'Upgrade: websocket',
                'Connection: Upgrade',
                'Sec-WebSocket-Accept: ' + hashKey(req.headers['sec-websocket-key'] || ''),
                '',
                ''
            ].join('\r\n');
            socket.write(resHeaders);
        
            socket.on('data', (data: Buffer) => {

                const byte1 = data.readUInt8(0);
                let opcode = byte1 & 0x0f;

                //二进制处理
                const byte2 = data.readUInt8(1);
                const strBin = byte2.toString(2);
                const MASK = strBin[0];

                let payloadLen: number | BigInt = parseInt(strBin.substring(1), 2);
                let curByte = 2;
                if(payloadLen == 126)
                {
                    //如果是126，说明长度用接下来的16位
                    payloadLen = data.readUint16BE(curByte)
                    curByte += 2
                }
                else if(payloadLen == 127)
                {
                    //如果是127长度，说明用接下来的64位
                    payloadLen = data.readBigUint64BE(curByte)
                    curByte += 8;
                }

                let payload = null
                if(MASK)
                {
                    const maskKey = data.slice(curByte, curByte + 4)
                    curByte += 4;

                    payload = data.slice(curByte, curByte + (payloadLen as number))
                    payload = decodeMask(maskKey, payload);
                }
                else
                {
                    payload = data.slice(curByte, curByte + (payloadLen as number))
                }
                
                this.handleOpcode(opcode, payload)
            });
            socket.on('close', (error) => {
                this.emit('close');
            });
        })
    }

    handleOpcode(opcode, payload) {
        //只处理两种
        switch (opcode) {
          case OPCODES.TEXT:
            this.emit('data', payload.toString('utf8'));
            break;
          case OPCODES.BINARY:
            this.emit('data', payload);
            break;
          default:
            this.emit('close');
            break;
        }
    }

    send(data) {
        let opcode;
        let buffer;
        if(Buffer.isBuffer(data))
        {
            opcode = OPCODES.BINARY;
            buffer = data;
        }
        else if (typeof data == "string")
        {
            opcode = OPCODES.TEXT
            buffer = Buffer.from(data, 'utf-8')
        }
        else
        {
            //统一 toString 发出去
            let str = `${data}`
            opcode = OPCODES.TEXT
            buffer = Buffer.from(str, 'utf-8')
        }

        this.socket.write(this.packFrame(opcode, buffer))
    }

    packFrame(opcode, payload): Buffer
    {
        let buffer = Buffer.alloc(payload.length + 2);
        //设置 FIN 1，opencode
        let byte1 = parseInt('10000000', 2) | opcode;
        let byte2 = payload.length; //只处理 <= 125

        buffer.writeUInt8(byte1, 0)
        buffer.writeUInt8(byte2, 1)

        //不设置Mask了
        payload.copy(buffer, 2)

        return buffer
    }
}
