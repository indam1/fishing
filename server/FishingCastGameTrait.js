import { BaseTrait } from '../BaseTrait';
import PlayerTrait from '../PlayerTrait';
import BlockNotificationTrait from '../Notification/BlockNotificationTrait';
import BlockNotificationBuilder from 'shared/Notification/BlockNotificationBuilder';
import { Icon, Title, TypeBlock } from 'shared/Enums/Notifications';
import EventManager from 'shared/EventManager';
import AnimationHandlerTrait from '../Animations/AnimationHandlerTrait';
import Fishing from 'configs/items/Fishing';
import AwaitLock from 'await-lock';
import FishingGameTrait from './FishingGameTrait';
import { cancellableSleep } from 'shared/Helpers/AsyncHelper';
import { castSpeed, waitingTime } from 'configs/fishing/fishingFormulas';

const DEFAULT_WIN_ZONE = 0.8;

/**
 * @property {Number} baseMaxSpeed
 * @property {Number} baseMinSpeed
 * @property {Number} baseMaxTime
 * @property {Number} baseMinTime
 * @property {Number} failAnimationTime
 * @property {Number} successAnimationTime
 * @property {Array} statuses
 */
export default class FishingCastGameTrait extends BaseTrait {
    animationList = {
        cast: 'FishingCast',
        castSuccess: 'FishingCastSuccess',
        castFail: 'FishingCastFail',
    };

    _sleeps = new Map();

    _animations = new Map();

    constructor(gameObject) {
        super(gameObject);
        gameObject.events.on(EventManager.INIT, () => this.onInit());
        gameObject.events.on(EventManager.FISHING.CAST.TRY_START, (e) => this.onTryStartCast(e));
    }

    onInit() {
        this.uiGO = this.gameObject.gameState.findGameObjectUI();
        this.notificationTrait = this.gameObject.gameState.findGameObjectNotification().getTraitByClass(BlockNotificationTrait);
        this.sortedStatuses = this.statuses ? this.statuses.sort((statusA, statusB) => statusB.zone - statusA.zone) : [];
        this._locks = this.gameObject.getTraitByClass(FishingGameTrait).locks;
    }

    onForceStop = async ({ userId }) => {
        const userGO = this.gameObject.gameState.getGameObjectByUserId(userId);
        userGO.events.off(EventManager.FISHING.CAST.STOP, this.onStopCast);
        userGO.events.off(EventManager.FISHING.FORCE_STOP, this.onForceStop);
        if (this._sleeps.has(userId)) {
            const sleep = this._sleeps.get(userId);
            this._sleeps.delete(userId);
            sleep.abort();
        }
        await this.stopAnimation(userId);
    };

    async onTryStartCast({ userId, baitId, fishingRodId }) {
        let lock = this._locks.get(userId);
        if (!lock) {
            lock = new AwaitLock();
            this._locks.set(userId, lock);
        }
        try {
            await lock.acquireAsync();
            const userGO = this.gameObject.gameState.getGameObjectByUserId(userId);
            userGO.events.on(EventManager.FISHING.FORCE_STOP, this.onForceStop);

            const playerTrait = userGO.getTraitByClass(PlayerTrait);

            const { bonusSpeed, attachment } = Fishing[fishingRodId]?.fishing;
            const speed = castSpeed(this.baseMaxSpeed, this.baseMinSpeed, bonusSpeed);
            await this.setAnimation(userId, this.animationList.cast, attachment);

            userGO.events.on(EventManager.FISHING.CAST.STOP, this.onStopCast);
            this.clientEventEmit(playerTrait.player, EventManager.FISHING.CAST.TRY_START, {
                speed,
                baitId,
                fishingRodId,
            });
            this.notify(userId, 'fishing.castGame', Icon.Check, TypeBlock.Success, Title.Performed);
        } finally {
            lock.release();
        }
    }

    onStopCast = async (e) => {
        let lock = this._locks.get(e.userId);
        if (!lock) {
            lock = new AwaitLock();
            this._locks.set(e.userId, lock);
        }
        try {
            await lock.acquireAsync();
            const userGO = this.gameObject.gameState.getGameObjectByUserId(e.userId);
            userGO.events.off(EventManager.FISHING.CAST.STOP, this.onStopCast);

            const pos = e.percentPosition;
            const status = this.selectStatus(pos);
            if (status.isWin) {
                await this.castSuccess(e, status);
            } else {
                await this.castFail(e, status);
            }
        } finally {
            lock.release();
        }
    };

    async castSuccess(e, status) {
        this.sendStatus(e.userId, status);
        this.notify(e.userId, 'fishing.waitingBait', Icon.Check, TypeBlock.Success, Title.Performed);

        const time = waitingTime(this.baseMaxTime, this.baseMinTime, e.percentPosition);
        const attachment = Fishing[e.fishingRodId]?.fishing?.attachment;
        await this.setAnimation(e.userId, this.animationList.castSuccess, attachment);
        const sleep = cancellableSleep((this.successAnimationTime + time) * 1000);
        this._sleeps.set(e.userId, sleep);
        await sleep;

        if (!this._sleeps.has(e.userId)) {
            return;
        }
        this._sleeps.delete(e.userId);

        await this.stopAnimation(e.userId);

        const userGO = this.gameObject.gameState.getGameObjectByUserId(e.userId);
        userGO.events.off(EventManager.FISHING.FORCE_STOP, this.onForceStop);

        this.gameObject.events.emit(EventManager.FISHING.PULL.TRY_START, e);
    }

    async castFail(e, status) {
        this.gameObject.events.emit(EventManager.FISHING.TAKE_BAIT, {
            userId: e.userId,
            fishingRodId: e.fishingRodId,
            baitId: e.baitId,
        });

        this.sendStatus(e.userId, status);
        this.notify(e.userId, 'fishing.failCast', Icon.Info, TypeBlock.Dangerous, Title.Info);

        const attachment = Fishing[e.fishingRodId]?.fishing?.attachment;
        await this.setAnimation(e.userId, this.animationList.castFail, attachment);
        const sleep = cancellableSleep(this.failAnimationTime * 1000);
        this._sleeps.set(e.userId, sleep);
        await sleep;

        if (!this._sleeps.has(e.userId)) {
            return;
        }
        this._sleeps.delete(e.userId);

        const userGO = this.gameObject.gameState.findGameObjectByUserId(e.userId);
        if (userGO) {
            await this.stopAnimation(e.userId);
            userGO.events.off(EventManager.FISHING.FORCE_STOP, this.onForceStop);

            userGO.events.emit(EventManager.FISHING.FAIL, {
                userId: e.userId,
                fishingRodId: e.fishingRodId,
                baitId: e.baitId,
            });
        }
    }

    notify(userId, text, icon, type, title) {
        const userGO = this.gameObject.gameState.getGameObjectByUserId(userId);
        const playerTrait = userGO.getTraitByClass(PlayerTrait);
        this.notificationTrait.clientEventEmit(playerTrait.player, EventManager.NOTIFICATION.SEND_BLOCK, {
            message: new BlockNotificationBuilder()
                .withText(text)
                .withIcon(icon)
                .withType(type)
                .withTitle(title)
                .jsonStringify(),
        });
    }

    selectStatus(position) {
        const status = this.sortedStatuses.reduce((result, statusItem) => {
            if (position >= 0.5 - statusItem.zone / 2 && position <= 0.5 + statusItem.zone / 2) {
                return statusItem;
            }
            return result;
        }, null);

        if (status === null) {
            const isWin = position >= 0.5 - DEFAULT_WIN_ZONE / 2 && position <= 0.5 + DEFAULT_WIN_ZONE / 2;
            return {
                isWin,
                color: isWin ? '#02B808' : '#FF0101',
            };
        }
        return status;
    }

    async setAnimation(userId, animation, attachment) {
        await this.stopAnimation(userId);
        const userGO = this.gameObject.gameState.getGameObjectByUserId(userId);
        /** @type {AnimationHandlerTrait} */
        const animationHandler = userGO.getTraitByClass(AnimationHandlerTrait);
        await animationHandler.setAnimation(animation, null, null, attachment ? { attachment } : null);
        this._animations.set(userId, animation);
    }

    async stopAnimation(userId) {
        if (!this._animations.has(userId)) {
            return;
        }
        const animation = this._animations.get(userId);
        const userGO = this.gameObject.gameState.getGameObjectByUserId(userId);
        /** @type {AnimationHandlerTrait} */
        const animationHandler = userGO.getTraitByClass(AnimationHandlerTrait);
        await animationHandler.stopAnimation(animation, false, false, null);
        this._animations.delete(userId);
    }

    sendStatus(userId, status) {
        const userGO = this.gameObject.gameState.getGameObjectByUserId(userId);
        const playerTrait = userGO.getTraitByClass(PlayerTrait);
        this.clientEventEmit(playerTrait.player, EventManager.FISHING.CAST.STATUS, {
            statusId: status.statusId,
            color: status.color,
        });
    }
}
