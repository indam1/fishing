import { BaseTrait } from '../BaseTrait';
import StorageTrait from '../StorageTrait';
import PlayerTrait from '../PlayerTrait';
import { StorageOperationReason } from 'shared/Enums/StorageOperation';
import BlockNotificationTrait from '../Notification/BlockNotificationTrait';
import { Icon, Title, TypeBlock } from 'shared/Enums/Notifications';
import EventManager from 'shared/EventManager';
import BlockNotificationBuilder from 'shared/Notification/BlockNotificationBuilder';
import { v1 as uuidV1 } from 'uuid';
import AllItems from 'configs/items/All';
import { safeSetTimeout } from 'shared/Helpers/TimeHelpers';
import AwaitLock from 'await-lock';

const NO_BAIT_ID = 'No';
const MAX_DATA_WAIT_TIME = 10000;

/**
 * @property {String} experienceGO
 * @property {Boolean|null} isHard
 */
export default class FishingGameTrait extends BaseTrait {
    _promises = [];

    _timers = new Map();

    locks = new Map();

    constructor(gameObject) {
        super(gameObject);
        gameObject.events.on(EventManager.INIT, () => this.onInit());
        gameObject.events.on(EventManager.FISHING.START, (e) => this.onStart(e));
        gameObject.events.on(EventManager.FISHING.TAKE_BAIT, (e) => this.onTakeBait(e));
        gameObject.events.on(EventManager.EXPERIENCE.SYNC, (e) => this.onSyncLevel(e));
    }

    onInit() {
        this.uiGO = this.gameObject.gameState.findGameObjectUI();
        this.notificationTrait = this.gameObject.gameState.findGameObjectNotification().getTraitByClass(BlockNotificationTrait);
        this.fishingExperienceGO = this.gameObject.gameState.getGameObjectById(this.experienceGO);
    }

    onSyncLevel({ userId, level }) {
        this.resolveAcquiredEvent(userId, level);
    }

    async onStart({ userId, baitId, fishingRodId }) {
        let lock = this.locks.get(userId);
        if (!lock) {
            lock = new AwaitLock();
            this.locks.set(userId, lock);
        }
        try {
            await lock.acquireAsync();
            const userGO = this.gameObject.gameState.getGameObjectByUserId(userId);
            const playerTrait = userGO.getTraitByClass(PlayerTrait);
            const hasEquip = await this.hasEquip(userId, baitId, fishingRodId);
            if (!hasEquip) {
                this.clientEventEmit(playerTrait.player, EventManager.FISHING.STOP, {});
                return;
            }

            const fishingRodLevel = AllItems[fishingRodId].conditions ? AllItems[fishingRodId].conditions.level : 0;
            const baitLevel = (baitId !== NO_BAIT_ID && AllItems[baitId].conditions) ? AllItems[baitId].conditions.level : 0;
            if (fishingRodLevel || baitLevel) {
                const userLevel = await this.acquireExperienceLevel(userId, this.fishingExperienceGO);
                if (userLevel < fishingRodLevel || userLevel < baitLevel) {
                    const requiredLevel = Math.max(fishingRodLevel, baitLevel);
                    this.notify(userId, ['fishing.noLevel', { level: requiredLevel }], Icon.Union, TypeBlock.Dangerous, Title.Error);
                    this.clientEventEmit(playerTrait.player, EventManager.FISHING.STOP, {});
                    return;
                }
            }

            userGO.events.on(EventManager.FISHING.FAIL, this.onFail);
            userGO.events.on(EventManager.FISHING.SUCCESS, this.onSuccess);
            userGO.events.on(EventManager.FISHING.TRY_FORCE_STOP, this.onTryForceStop);
            this.gameObject.events.emit(EventManager.FISHING.CAST.TRY_START, {
                userId,
                baitId,
                fishingRodId,
            });
        } finally {
            lock.release();
        }
    }

    async onTakeBait(e) {
        const operationId = uuidV1();
        await this.takeBait(e.userId, e.baitId, operationId);
    }

    onSuccess = async (e) => {
        let lock = this.locks.get(e.userId);
        if (!lock) {
            lock = new AwaitLock();
            this.locks.set(e.userId, lock);
        }
        try {
            await lock.acquireAsync();
            const userGO = this.gameObject.gameState.getGameObjectByUserId(e.userId);
            userGO.events.off(EventManager.FISHING.FAIL, this.onFail);
            userGO.events.off(EventManager.FISHING.SUCCESS, this.onSuccess);
            userGO.events.off(EventManager.FISHING.TRY_FORCE_STOP, this.onTryForceStop);

            const playerTrait = userGO.getTraitByClass(PlayerTrait);
            const operationId = uuidV1();
            const takeBait = await this.takeBait(e.userId, e.baitId, operationId);
            if (!takeBait) {
                this.clientEventEmit(playerTrait.player, EventManager.FISHING.STOP, {});
                return;
            }
            const prize = e.prize;
            const text = ['fishing.successFish', {
                item: i18n.t(`items.${prize.rewardId}.label`),
                exp: prize.experience,
            }];
            this.notify(e.userId, text, Icon.Check, TypeBlock.Success, Title.Performed);

            this.fishingExperienceGO.events.emit(EventManager.EXPERIENCE.RAISE, {
                userId: e.userId,
                experience: prize.experience,
            });
            const storageTrait = userGO.getTraitByClass(StorageTrait);
            const canPut = storageTrait.canPut(prize.rewardId, 1);
            if (!canPut) {
                const cantPutText = ['empty', { text: i18n.t('itemShops.text.cantPut') }];
                this.notify(e.userId, cantPutText, Icon.Union, TypeBlock.Dangerous, Title.Error, true);
            } else {
                await storageTrait.put(prize.rewardId, 1, StorageOperationReason.Fishing, `${prize.experience}`, operationId);
            }

            this.clientEventEmit(playerTrait.player, EventManager.FISHING.TRY_START, {
                fishingRodId: e.fishingRodId,
                baitId: e.baitId,
            });
        } finally {
            lock.release();
        }
    };

    onFail = async (e) => {
        let lock = this.locks.get(e.userId);
        if (!lock) {
            lock = new AwaitLock();
            this.locks.set(e.userId, lock);
        }
        try {
            await lock.acquireAsync();
            const userGO = this.gameObject.gameState.getGameObjectByUserId(e.userId);
            userGO.events.off(EventManager.FISHING.FAIL, this.onFail);
            userGO.events.off(EventManager.FISHING.SUCCESS, this.onSuccess);
            userGO.events.off(EventManager.FISHING.TRY_FORCE_STOP, this.onTryForceStop);

            const playerTrait = userGO.getTraitByClass(PlayerTrait);
            const hasEquip = await this.hasEquip(e.userId, e.baitId, e.fishingRodId);
            if (!hasEquip) {
                this.clientEventEmit(playerTrait.player, EventManager.FISHING.STOP, {});
                return;
            }
            this.clientEventEmit(playerTrait.player, EventManager.FISHING.TRY_START, {
                fishingRodId: e.fishingRodId,
                baitId: e.baitId,
            });
        } finally {
            lock.release();
        }
    };

    onTryForceStop = (e) => {
        const userGO = this.gameObject.gameState.getGameObjectByUserId(e.userId);
        userGO.events.off(EventManager.FISHING.FAIL, this.onFail);
        userGO.events.off(EventManager.FISHING.SUCCESS, this.onSuccess);
        userGO.events.off(EventManager.FISHING.TRY_FORCE_STOP, this.onTryForceStop);

        userGO.events.emit(EventManager.FISHING.FORCE_STOP, { userId: e.userId });
        const playerTrait = userGO.getTraitByClass(PlayerTrait);
        this.clientEventEmit(playerTrait.player, EventManager.FISHING.FORCE_STOP, {});
    };

    async takeBait(userId, baitId, operationId = null) {
        const userGO = this.gameObject.gameState.findGameObjectByUserId(userId);
        if (!userGO) {
            return false;
        }
        /** @type {StorageTrait} */
        const storageTrait = userGO.getTraitByClass(StorageTrait);
        const baitQuantity = storageTrait.getQuantity(baitId);
        if (!baitQuantity && baitId !== NO_BAIT_ID) {
            console.error(`No bait "${baitId}" at user ${userId}`);
            return false;
        }
        if (operationId && baitId !== NO_BAIT_ID) {
            this.notify(userId, 'fishing.baitLost', Icon.Info, TypeBlock.Attention, Title.Info);
            await storageTrait.take(baitId, 1, StorageOperationReason.Fishing, '', operationId);
        }
        return true;
    }

    async hasEquip(userId, baitId, fishingRodId) {
        const userGO = this.gameObject.gameState.findGameObjectByUserId(userId);
        /** @type {StorageTrait} */
        const storageTrait = userGO.getTraitByClass(StorageTrait);
        const baitQuantity = storageTrait.getQuantity(baitId);
        const fishingRodQuantity = storageTrait.getQuantity(fishingRodId);
        if (!baitQuantity && baitId !== NO_BAIT_ID) {
            this.notify(userId, 'fishing.noBaits', Icon.Union, TypeBlock.Dangerous, Title.Error);
            this.onTryForceStop({ userId });
            return false;
        }
        if (!fishingRodQuantity) {
            this.notify(userId, 'fishing.noFishingRod', Icon.Union, TypeBlock.Dangerous, Title.Error);
            this.onTryForceStop({ userId });
            return false;
        }
        return true;
    }

    acquireExperienceLevel(userId, gameObject) {
        const event = EventManager.EXPERIENCE.RETRIEVE;

        clearTimeout(this._timers.get(userId));
        this._timers.set(userId, safeSetTimeout(() => {
            console.error(new Error(`Timeout resolving acquired event - ${event} for user ${userId}`));
            this.resolveAcquiredEvent(userId, event, null);
        }, MAX_DATA_WAIT_TIME));

        return new Promise((resolve) => {
            this._promises.push({
                userId,
                resolve,
            });
            gameObject.events.emit(event, {
                userId,
                gameObjectId: this.gameObject.id,
            });
        });
    }

    resolveAcquiredEvent(userId, level) {
        clearTimeout(this._timers.get(userId));
        this._timers.delete(userId);

        const eventItemIndex = this._promises.findIndex(item => item.userId === userId);
        if (eventItemIndex === -1) {
            return;
        }

        const eventItem = this._promises[eventItemIndex];
        eventItem.resolve(level);

        this._promises.splice(eventItemIndex, 1);
    }

    notify(userId, text, icon, type, title, isOld = false) {
        const userGO = this.gameObject.gameState.getGameObjectByUserId(userId);
        const playerTrait = userGO.getTraitByClass(PlayerTrait);
        this.notificationTrait.clientEventEmit(playerTrait.player, EventManager.NOTIFICATION.SEND_BLOCK, {
            message: new BlockNotificationBuilder()
                .withText(text)
                .withIcon(icon)
                .withType(type)
                .withTitle(title)
                .withIsOld(isOld)
                .jsonStringify(),
        });
    }
}
