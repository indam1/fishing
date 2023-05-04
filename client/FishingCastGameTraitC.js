import { BaseTraitC } from '../BaseTraitC';
import PhoneTraitC from 'client_src/traits/PhoneTraitC';
import { GetPlayerTrait } from 'client_src/Helpers/Player';

/**
 * @property {Array} statuses
 */
export default class FishingCastGameTraitC extends BaseTraitC {
    constructor(gameObject) {
        super(gameObject);
        gameObject.events.on(EventManager.INIT, () => this.onInit());
        gameObject.events.on(EventManager.FISHING.CAST.TRY_START, (e) => this.onTryStart(e));
        gameObject.events.on(EventManager.FISHING.CAST.TRY_STOP, (e) => this.onTryStop(e));
        gameObject.events.on(EventManager.FISHING.CAST.STATUS, (e) => this.onStatus(e));
    }

    onInit() {
        this.uiGO = this.gameObject.gameState.findGameObjectUI();
        /** @type {PhoneTraitC} */
        this.phone = this.uiGO.getTraitByClass(PhoneTraitC);
    }

    onTryStart(e) {
        this.uiGO.events.emit(EventManager.FISHING.CAST.START, e);
        this.phone.showCursor();
    }

    onTryStop(e) {
        GetPlayerTrait().serverEventEmit(EventManager.FISHING.CAST.STOP, e);
        this.phone.showCursor();
    }

    onStatus(e) {
        this.uiGO.events.emit(EventManager.FISHING.CAST.STATUS, e);
        this.phone.showCursor();
    }
}
