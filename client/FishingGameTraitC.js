import { BaseTraitC } from '../BaseTraitC';
import { NearDetector } from 'client_src/Helpers/NearDetector';
import ZoneTraitC from 'client_src/traits/ZoneTraitC';
import BlockNotificationBuilder from 'shared/Notification/BlockNotificationBuilder';
import { Icon, Title, TypeBlock } from 'shared/Enums/Notifications';
import { ArrayToVector } from 'shared/Helpers/Vector3Helper';
import PhoneTraitC from 'client_src/traits/PhoneTraitC';
import { GetPlayerGameObject, GetPlayerTrait } from 'client_src/Helpers/Player';
import EventManager from 'shared/EventManager';
import GraphicRenderTraitC from 'client_src/traits/GraphicRenderTraitC';
import RandomZoneTraitC from 'client_src/traits/RandomZoneTraitC';
import MarkerTraitC from 'client_src/traits/MarkerTraitC';
import RouteManagerTraitC from 'client_src/traits/RouteManagerTraitC';
import { PolygonZoneDetector } from 'client_src/Helpers/PolygonZoneDetector';
import CameraWrapper from '../../Helpers/CameraWrapper';
import CameraConfig from '../../Helpers/CameraConfig';
import { CAMERA_VIEW_FISHING } from 'configs/shops/cameraView';
import FactionApiTraitC from 'client_src/traits/Alliance/FactionApiTraitC';

const INVALIDATE_IDLE_CAM = '0xF4F2C0D4EE209E20';
const DEFAULT_BEHAVIOR = 'normal';

/**
 * @property {String} experienceGO
 * @property {Array} forbidFactionIds
 * @property {Boolean|null} isHard
 */
export default class FishingGameTraitC extends BaseTraitC {
    routeToMarker = false;

    distance = 10;

    depth = 3;

    allWater = false;

    isStarted = false;

    constructor(gameObject) {
        super(gameObject);
        gameObject.events.on(EventManager.INIT, () => this.onInit());
        gameObject.events.on(EventManager.FISHING.FORCE_STOP, () => this.onStop());
        gameObject.events.on(EventManager.FISHING.STOP, () => this.onStop());
        gameObject.events.on(EventManager.FISHING.TRY_START, (e) => this.onTryStart(e));
        gameObject.events.on(EventManager.FISHING.CHANGE_CAMERA, (e) => this.onChangeCamera(e));
    }

    onInit() {
        if (!this.isHard) {
            /** @type {ZoneTraitC} */
            this.zoneTrait = this.gameObject.getTraitByClass(ZoneTraitC);

            this._nearDetector = this.zoneTrait.polygon
                ? new PolygonZoneDetector(this.zoneTrait.polygon, this.zoneTrait.height)
                : new NearDetector(ArrayToVector(this.zoneTrait.position), this.zoneTrait.radius);
            this._nearDetector.onEnter = () => this.onSetZone(true);
            this._nearDetector.onExit = () => this.onSetZone(false);
        } else {
            /** @type {RandomZoneTraitC} */
            this.randomZoneTrait = this.gameObject.getTraitByClass(RandomZoneTraitC);

            this._nearDetector = this.randomZoneTrait;
            this._nearDetector.onEnter = () => this.onEnterRandomZone(false);
            this._nearDetector.onExit = () => this.onExitRandomZone(false);
            this._nearDetector.onDelete = () => this.onExitRandomZone(true);
        }

        this.notificationGO = this.gameObject.gameState.findGameObjectNotification();
        this.uiGO = this.gameObject.gameState.findGameObjectUI();
        this.uiGO.events.once(EventManager.PHONE.INITIALIZED, () => this.onPhoneInit());

        this.uiGO.events.on(EventManager.PHONE.OPEN, () => this.onTryForceStop());
        this.uiGO.events.on(EventManager.UI.KEYBOARD.USED_BUTTON_SPACE, () => this.onTryForceStop());
        GetPlayerGameObject().events.on(EventManager.PLAYER.DEATH, () => this.onTryForceStop());
        GetPlayerGameObject().events.on(EventManager.HANDCUFF.HANDCUFF_ON, () => this.onTryForceStop());

        /** @type {PhoneTraitC} */
        this.phone = this.uiGO.getTraitByClass(PhoneTraitC);
        /** @type {GraphicRenderTraitC} */
        this.renderTrait = this.uiGO.getTraitByClass(GraphicRenderTraitC);
        /** @type {RouteManagerTraitC} */
        this.routeManager = this.uiGO.getTraitByClass(RouteManagerTraitC);
        /** @type {FactionApiTraitC} */
        this.factionApi = this.gameObject.gameState.getGameObjectById('Alliance')
            .getTraitByClass(FactionApiTraitC);
    }

    onPhoneInit() {
        if (this.isHard) {
            if (this.randomZoneTrait.isInside()) {
                this.onEnterRandomZone(false);
            }
            return;
        }

        if (this._nearDetector.isInside()) {
            this.onSetZone(true);
        }
    }

    onTryForceStop() {
        if (!this.isStarted) {
            return;
        }
        GetPlayerTrait().serverEventEmit(EventManager.FISHING.TRY_FORCE_STOP, {});
    }

    onStop() {
        this.isStarted = false;
        if (this._cameraWrapper) {
            this._cameraWrapper.setActive(false);
        }
        this.uiGO.events.emit(EventManager.FISHING.UI.STOP, {});
        this.phone.hideCursor();
    }

    onTryStart({ baitId, fishingRodId }) {
        const professionId = GetPlayerTrait().user.professionId;
        const factionId = this.factionApi.getFactionByProfessionId(professionId).id;
        if (this.forbidFactionIds.includes(factionId)) {
            this.notify(TypeBlock.Attention, Icon.Attention, Title.Warning, 'fishing.noFaction');
            this.onStop();
            return;
        }

        if (!this._nearDetector.isInside()) {
            this.notify(TypeBlock.Attention, Icon.Attention, Title.Warning, 'fishing.noZone');
            this.uiGO.events.emit(EventManager.FISHING.SET_ZONE, {
                fishingGameObjectId: null,
            });
            this.onStop();
            return;
        }

        const player = GetPlayerTrait().player;
        if (player.isSwimmingUnderWater() || player.isSwimming()) {
            this.notify(TypeBlock.Attention, Icon.Attention, Title.Warning, 'fishing.noSwim');
            this.onStop();
            return;
        }

        const hasWater = this.allWater
            ? this.getAllWaterPosition()
            : this.getWaterPosition();
        if (!hasWater) {
            this.notify(TypeBlock.Attention, Icon.Attention, Title.Warning, 'fishing.noWater');
            this.onStop();
            return;
        }

        GetPlayerTrait().serverEventEmit(EventManager.ALTERNATE_MOVEMENT.SET, { movementId: DEFAULT_BEHAVIOR });
        this.isStarted = true;
        this.initCamera();
        this.serverEventEmit(EventManager.FISHING.START, {
            baitId,
            fishingRodId,
        });
        this.phone.showCursor();
    }

    onEnterRandomZone(isCreate) {
        this.renderTrait.addCallback('fishingCam', () => this.disableAfkCamera());
        this.notify(TypeBlock.Attention, Icon.Attention, Title.Warning, `fishing.zone.random.${isCreate ? 'create' : 'enter'}`);
        this.uiGO.events.emit(EventManager.FISHING.SET_ZONE, {
            fishingGameObjectId: this.gameObject.id,
        });
    }

    onExitRandomZone(isDelete) {
        this.renderTrait.removeCallback('fishingCam');
        this.notify(TypeBlock.Attention, Icon.Attention, Title.Warning, `fishing.zone.random.${isDelete ? 'delete' : 'exit'}`);
        this.onTryForceStop();
    }

    onSetZone(hasZone) {
        if (hasZone) {
            if (this.routeToMarker) {
                this.routeManager.resetRoute();
                this.routeToMarker = false;
            }
            this.renderTrait.addCallback('fishingCam', () => this.disableAfkCamera());
        } else {
            this.onTryForceStop();
            this.renderTrait.removeCallback('fishingCam');
        }

        this.uiGO.events.emit(EventManager.FISHING.SET_ZONE, {
            fishingGameObjectId: hasZone ? this.gameObject.id : null,
        });
        this.notify(TypeBlock.Attention, Icon.Attention, Title.Warning, `fishing.zone.${hasZone ? 'enter' : 'exit'}`);
    }

    onChangeCamera(e) {
        const xDiff = parseFloat(e.position[0]);
        const yDiff = parseFloat(e.position[1]);
        const camConf = this._cameraWrapper._config;

        camConf.camXY = Math.max(Math.min(camConf.camXY + yDiff / CAMERA_VIEW_FISHING.zoomSpeed, CAMERA_VIEW_FISHING.zoomMax), CAMERA_VIEW_FISHING.zoomMin);
        camConf.angle += xDiff / CAMERA_VIEW_FISHING.rotationSpeed;

        this._cameraWrapper.setConfig(camConf);
    }

    initCamera() {
        if (this._cameraWrapper && this._cameraWrapper.isActive()) {
            return;
        }
        const player = GetPlayerTrait().player;
        const cameraConfig = new CameraConfig();
        cameraConfig.xy = 0;
        cameraConfig.z = 0;
        cameraConfig.fov = 45;
        cameraConfig.camXY = -5;
        cameraConfig.camZ = 2;
        cameraConfig.angle = 0;
        this._cameraWrapper = new CameraWrapper(player.position, player.getHeading(), cameraConfig);
        this._cameraWrapper.setActive(true);
    }

    disableAfkCamera() {
        if (this._cameraWrapper) {
            const player = GetPlayerTrait().player;
            this._cameraWrapper.setCameraPosition(player.position);
        }
        mp.game.invoke(INVALIDATE_IDLE_CAM);
    }

    makeRoute() {
        const markerPosition = this.gameObject.findTraitByClass(MarkerTraitC).position;
        this.routeManager.setRoute(markerPosition[0], markerPosition[1], markerPosition[2]);
        this.routeToMarker = true;
    }

    notify(type, icon, title, text) {
        this.notificationGO.events.emit(EventManager.NOTIFICATION.SEND_BLOCK, {
            message: new BlockNotificationBuilder()
                .withType(type)
                .withIcon(icon)
                .withTitle(title)
                .withText(text),
        });
    }
}
