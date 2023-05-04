<template>
    <div class="cast">
        <div :class="['cast-status', status ? 'cast-status--active' : '']" :style="statusStyle">
            {{ status ? $t(`fishing.status.cast.${status.statusId}`) : '' }}
        </div>
        <div class="cast-bar" ref="bar" :style="barStyle">
            <div class="cast-bar-hook" ref="hook" :style="{'margin-left':`${marginLeft}px`}">
                <HookIcon/>
            </div>
        </div>
        <div class="cast-mouse"><MouseIcon/></div>
    </div>
</template>

<script>
import HookIcon from 'components/hud/icons/HookIcon';
import { safeSetInterval, safeSetTimeout } from 'shared/Helpers/TimeHelpers';
import MouseIcon from 'components/hud/icons/MouseIcon';
import { mapGetters, mapMutations, mapState } from 'vuex';
import { SendToGameObject } from 'sharedUI/GameObject';
import SingleEventListener from 'sharedUI/SingleEventListener';

const MAX_DELAY = 2000;
const MIN_DELAY = 1000;
const singleEventListener = new SingleEventListener();
export default {
    name: 'Cast',
    data() {
        return {
            hookWidth: null,
            barWidth: null,
            marginLeft: null,
            turnRight: true,
            startTime: null,
            gameInterval: null,
            resetTimeout: null,
            startTimeout: null,
            status: null,
        };
    },
    components: { MouseIcon, HookIcon },
    computed: {
        ...mapState('fishing', ['bait', 'fishingGameObjectId', 'fishingRod']),
        ...mapGetters('user', ['getUserId']),
        gameWidth() {
            return this.barWidth && this.hookWidth ? this.barWidth - this.hookWidth : 0;
        },
        statusStyle() {
            return this.status ? {
                color: this.status.color,
                'text-shadow': `1px 1px 18px ${this.status.color}, 0px 4px 4px rgba(0, 0, 0, 0.3)`,
            } : '';
        },
        turnCoef() {
            return this.turnRight ? 1 : -1;
        },
        barStyle() {
            return {
                background: `linear-gradient(270deg,
                    #D70000 0.1%,
                    #D70000 ${Math.min(this.winZone - 5, 0.1)}%,
                    #2E7218 ${this.winZone}%,
                    #2E7218 ${Math.max(this.superGreenZone - 5, this.winZone)}%,
                    #02B808 ${this.superGreenZone}%,
                    #02B808 49.99%,
                    #02B808 ${100 - this.superGreenZone}%,
                    #347921 ${Math.min(105 - this.superGreenZone, 100 - this.winZone)}%,
                    #347921 ${100 - this.winZone}%,
                    #D70000 ${Math.max(105 - this.winZone, 99.9)}%,
                    #D70000 99.9%)`,
            };
        },
    },
    mounted() {
        singleEventListener.on('UI', EventManager.FISHING.CAST.STATUS, (e) => {
            this.status = {
                statusId: e.statusId,
                color: e.color,
            };

            this.resetTimeout = safeSetTimeout(() => {
                this.RESET();
            }, 1500);
        });
        this.hookWidth = this.$refs.hook.getBoundingClientRect().width;
        this.barWidth = this.$refs.bar.getBoundingClientRect().width;
        this.marginLeft = 0;

        document.addEventListener('mousedown', this.stopGame);
        const delay = Math.floor(Math.random() * (MAX_DELAY - MAX_DELAY + 1)) + MIN_DELAY;
        this.startTimeout = safeSetTimeout(() => {
            this.startGame();
        }, delay);
    },
    methods: {
        ...mapMutations('fishing', ['RESET']),
        startGame() {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
            this.startTime = Date.now();
            this.gameInterval = safeSetInterval(() => {
                this.marginLeft += this.turnCoef * (Date.now() - this.startTime) * this.speed;
                this.marginTop = Math.min(Math.max(this.marginTop, 0), this.gameHeight);

                if (this.marginLeft >= this.gameWidth) {
                    this.turnRight = false;
                }

                if (this.marginLeft <= 0) {
                    this.turnRight = true;
                }

                this.startTime = Date.now();
            }, 1);
        },
        stopGame() {
            document.removeEventListener('mousedown', this.stopGame);
            this.clearGameInterval();
            SendToGameObject(this.fishingGameObjectId, EventManager.FISHING.CAST.TRY_STOP, {
                fishingRodId: this.fishingRod,
                baitId: this.bait,
                percentPosition: this.marginLeft / this.gameWidth,
                userId: this.getUserId,
            });
        },
        reset() {
            document.removeEventListener('mousedown', this.stopGame);
            this.hookWidth = null;
            this.barWidth = null;
            this.marginLeft = null;
            this.turnRight = true;
            this.startTime = null;
            this.status = null;
            this.clearGameInterval();
        },
        clearGameInterval() {
            clearInterval(this.gameInterval);
            this.gameInterval = null;
            clearTimeout(this.resetTimeout);
            this.resetTimeout = null;
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        },
    },
    destroyed() {
        document.removeEventListener('mousedown', this.stopGame);
        singleEventListener.cleanup();
    },
    props: ['speed', 'winZone', 'superGreenZone'],
};
</script>

<style lang="scss" scoped>
.cast {
    margin-top: 5%;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    &-bar {
        margin-top: 24px;
        display: flex;
        width: 400px;
        height: 32px;
        border: 1px solid #0070AE;
        border-radius: 5px;

        &-hook {
            display: flex;
            margin-top: 2px;
        }
    }

    &-status {
        display: block;
        visibility: hidden;
        opacity: 0;
        font-family: 'Roboto';
        font-style: normal;
        font-weight: 400;
        font-size: 50px;
        text-transform: uppercase;
        transition: 1s all;

        &--active {
            visibility: visible;
            opacity: 1;
            letter-spacing: 15px;
        }
    }

    &-mouse {
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(38, 38, 38, 0.8);
        border: 1px solid #0070AE;
        margin-top: 24px;
        width: 64px;
        height: 64px;
        border-radius: 50%;
    }
}
</style>
