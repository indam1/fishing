<template>
    <div class="fishing" :style="positionStyle">
        <Cast
            ref="cast"
            :speed="castSpeed"
            :winZone="winZone"
            :superGreenZone="superGreenZone"
            v-if="currentStage === 'cast'"
        />
        <Pull
            ref="pull"
            :speed="pullSpeed"
            :value="value"
            :constraint="constraint"
            :endTime="endTime"
            :topEdge="topEdge"
            :bottomEdge="bottomEdge"
            v-if="currentStage === 'pull'"
        />
    </div>
</template>

<script>
import Pull from './Pull';
import Cast from './Cast';
import { mapMutations, mapState } from 'vuex';
import SingleEventListener from 'sharedUI/SingleEventListener';
import { randomFloat, randomInt } from 'configs/fishing/fishingFormulas';
const singleEventListener = new SingleEventListener();
export default {
    name: 'Fishing',
    data() {
        return {
            endTime: null,
            castSpeed: null,
            pullSpeed: null,
            value: null,
            constraint: null,
            bottomEdge: null,
            topEdge: null,
            winZone: null,
            superGreenZone: null,

            randomOffsetHeight: 0,
            randomOffsetWidth: 0,
        };
    },
    components: { Cast, Pull },
    computed: {
        ...mapState('fishing', ['currentStage']),
        positionStyle() {
            return {
                top: `calc(50% - ${this.randomOffsetHeight}px)`,
                left: `calc(50% + ${this.randomOffsetWidth}px)`,
            };
        },
    },
    methods: {
        ...mapMutations('fishing', ['RESET', 'TOGGLE_GAME']),
        resetGame() {
            if (this.$refs.pull) {
                this.$refs.pull.reset();
            }
            if (this.$refs.cast) {
                this.$refs.cast.reset();
            }
            this.RESET();
            this.TOGGLE_GAME(false);
            this.randomOffsetWidth = 0;
            this.randomOffsetHeight = 0;
            this.endTime = null;
            this.castSpeed = null;
            this.pullSpeed = null;
            this.value = null;
            this.constraint = null;
            this.winZone = null;
            this.superGreenZone = null;
        },
    },
    beforeMount() {
        singleEventListener.on('UI', EventManager.FISHING.UI.STOP, () => this.resetGame());
        singleEventListener.on('UI', EventManager.FISHING.CAST.START, (e) => {
            const sign = randomInt(1, 0) ? -1 : 1;
            const number = randomInt(100, 50);
            this.randomOffsetWidth = sign * number;
            const DEFAULT_HEIGHT = 32;
            this.randomOffsetHeight = DEFAULT_HEIGHT * randomFloat(2, 0);
            this.winZone = 100 * ((1 - e.winZone) / 2);
            this.superGreenZone = 100 * ((1 - e.superGreenZone) / 2);
            this.castSpeed = e.speed;
        });
        singleEventListener.on('UI', EventManager.FISHING.PULL.START, (e) => {
            this.randomOffsetWidth = 0;
            this.randomOffsetHeight = 0;
            this.endTime = e.endTime;
            this.pullSpeed = e.speed;
            this.value = e.value;
            this.constraint = e.constraint;
            this.topEdge = e.topEdge;
            this.bottomEdge = e.bottomEdge;
        });
    },
    destroyed() {
        singleEventListener.cleanup();
    },
};
</script>

<style lang="scss" scoped>
.fishing {
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);

    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
}
</style>
