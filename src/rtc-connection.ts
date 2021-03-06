import { Stream, TGCalls } from './tgcalls';
import { Binding } from './binding';

export class RTCConnection {
    tgcalls: TGCalls<any>;
    audioStream: Stream;
    videoStream: Stream;

    constructor(
        public chatId: number,
        public binding: Binding,
        public bufferLength: number,
        public inviteHash: string,
        public audioParams: any,
        public videoParams?: any,
    ) {
        this.tgcalls = new TGCalls({ chatId: this.chatId });
        const fileAudioPath = audioParams.path;
        const fileVideoPath = videoParams === undefined ? undefined:videoParams.path;
        this.audioStream = new Stream(fileAudioPath, 16, audioParams.bitrate, 1, bufferLength);
        this.videoStream = new Stream(fileVideoPath);

        this.tgcalls.joinVoiceCall = async (payload: any) => {
            payload = {
                chat_id: this.chatId,
                ufrag: payload.ufrag,
                pwd: payload.pwd,
                hash: payload.hash,
                setup: payload.setup,
                fingerprint: payload.fingerprint,
                source: payload.source,
                source_groups: payload.source_groups,
                have_video: fileVideoPath === undefined,
                invite_hash: this.inviteHash,
            };

            Binding.log(
                'callJoinPayload -> ' + JSON.stringify(payload),
                Binding.INFO,
            );

            const joinCallResult = await this.binding.sendUpdate({
                action: 'join_voice_call_request',
                payload: payload,
            });

            Binding.log(
                'joinCallRequestResult -> ' + JSON.stringify(joinCallResult),
                Binding.INFO,
            );

            return joinCallResult;
        };
        this.audioStream.on('finish', async () => {
            await this.binding.sendUpdate({
                action: 'stream_audio_ended',
                chat_id: chatId,
            });
        });
        this.videoStream.on('finish', async () => {
            await this.binding.sendUpdate({
                action: 'stream_video_ended',
                chat_id: chatId,
            });
        });
        this.audioStream.on('stream_deleted', async () => {
            this.audioStream.stop();
            this.videoStream.stop();
            await this.binding.sendUpdate({
                action: 'update_request',
                result: 'STREAM_DELETED',
                chat_id: chatId,
            });
        });
        this.videoStream.on('stream_deleted', async () => {
            this.audioStream.stop();
            this.videoStream.stop();
            await this.binding.sendUpdate({
                action: 'update_request',
                result: 'STREAM_DELETED',
                chat_id: chatId,
            });
        });
        this.audioStream.remotePlayingTime = () => {
            return {
                time: this.videoStream.currentPlayedTime()
            }
        };
        this.videoStream.remotePlayingTime = () => {
            return {
                time: this.audioStream.currentPlayedTime()
            }
        };
    }

    async joinCall() {
        try {
            const video_width = this.videoParams === undefined ? 1:this.videoParams.width;
            const video_height = this.videoParams === undefined ? 1:this.videoParams.height;
            const video_framerate = this.videoParams === undefined ? 1:this.videoParams.framerate;
            const videoTrack = this.videoStream.createVideoTrack(
                video_width,
                video_height,
                video_framerate,
            );
            let result = await this.tgcalls.start(this.audioStream.createAudioTrack(), videoTrack);
            this.videoStream.resume();
            this.audioStream.resume();
            return result;
        } catch (e: any) {
            this.audioStream.stop();
            this.videoStream.stop();
            Binding.log('joinCallError -> ' + e.toString(), Binding.ERROR);
            return false;
        }
    }

    stop() {
        try {
            this.audioStream.stop();
            this.videoStream.stop();
            this.tgcalls.close();
        } catch (e) {}
    }

    async leave_call() {
        try {
            this.stop();
            return await this.binding.sendUpdate({
                action: 'leave_call_request',
                chat_id: this.chatId,
            });
        } catch (e: any) {
            return {
                action: 'REQUEST_ERROR',
                message: e.toString(),
            };
        }
    }

    async pause() {
        this.audioStream.pause();
        this.videoStream.pause();
        if(this.videoParams != undefined){
            await this.binding.sendUpdate({
                action: 'upgrade_video_status',
                chat_id: this.chatId,
                paused_status: true,
            });
        }
    }

    async resume() {
        this.audioStream.resume();
        this.videoStream.resume();
        if(this.videoParams != undefined){
            await this.binding.sendUpdate({
                action: 'upgrade_video_status',
                chat_id: this.chatId,
                paused_status: false,
            });
        }
    }

    async changeStream(audioParams: any, videoParams?: any,) {
        this.audioStream.setReadable(audioParams.path);
        this.audioParams = audioParams;
        this.audioStream.setAudioParams(audioParams.bitrate);
        if(
            !(this.videoParams == undefined && videoParams == undefined) ||
            !(this.videoParams != undefined && videoParams != undefined)
        ){
            await this.binding.sendUpdate({
                action: 'upgrade_video_status',
                chat_id: this.chatId,
                stopped_status: videoParams == undefined
            });
        }
        this.videoParams = videoParams;
        if(this.videoParams != undefined){
            this.videoStream.setVideoParams(
                this.videoParams.width,
                this.videoParams.height,
                this.videoParams.framerate,
            )
        }
        this.videoStream.setReadable(this.videoParams == undefined ? undefined:this.videoParams.path);
    }
}
