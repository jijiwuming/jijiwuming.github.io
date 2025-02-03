---
title: el-table-column设置fixed的影响
tags: [vue 2, element-ui]
categories: [前端]
cover: https://th.bing.com/th/id/OIP.IXOC4xuxXLQGvzTWKxJgdAHaGF
---
## 背景描述

这几天在维护Vue2项目时产生了一个bug，表现为表格中的popover组件弹出后通过$refs去获取子组件操作属性突然失效了。
由于一开始只从展示效果上看到这个问题，控制台没有报错。所以一开始还陷入了误判，刚开始认为是某些改动导致相关属性失去了响应性。但是翻阅了下自己的代码，调整了一部分代码后，发现问题并没有解决，而且感觉代码确实也没啥问题，一下子尬住了。

### Environment

{
  "element-ui": "^2.13.0",
  "vue": "^2.6.10"
}
## TL;DR;
Element-UI在实现Fixed效果的手段为：针对有Column设置Fixed的ElTable会重复渲染table的body部分，然后重叠body来实现定位效果。
而重复渲染table-body会导致表格体内的子元素被多次渲染，而多次渲染会导致$refs被覆盖为最后创建的一个。
不幸的是，最后创建的table-body是为fixed="right"特别构建的部分，虽然也<b style="color:red;">渲染了整个表格</b>，但是<b style="color:red;">仅展示右侧固定列部分</b>。这种情况下，通过$refs获取到的子组件就是在这个区域内的，但是，如果你想操作的恰好是左侧非固定列的部分，不好意思，bug来了，你拿到的只是一个看不到的元素。
所以出现这种问题的时候，比较快的解决方法是去除ElTable上所有column的fixed属性设置，如果想看具体原因和解决方案，还烦请您耐心看下文章后半部分。

## 复现代码

参考[problem-reproduction](https://github.com/jijiwuming/problem-reproduction/blob/main/src/components/table.vue)

也可尝试[在线编辑](https://stackblitz.com/~/github.com/jijiwuming/problem-reproduction)

## 问题定位

由于这部分可以确认之前是正常的，但是具体出现问题的时间节点暂不明确，无奈，尝试了几个早期版本的镜像，希望能快速找到上一个正常的时间节点，对比代码差异来找原因。
好在运气不错，出问题的时间并不长，从镜像看恰好是一周前，与当前比只差了5个提交。
得，Code Review吧，然而，看了一圈：我寻思我也妹写啥相关的代码啊？
啧，改回去试试，很快啊，本地代码就起起来了，回退了几处看上去勉强相关的，不出所料，确实没相关。
这不就艹了么这，那就再试试没那么相关的，好家伙，到了发现是另一个el-table-column上设置fixed="right"就会有这个问题
我：地铁老人手机.jpg，不是，这又怎么着了嘛，这都不是table-column，这怎么挨上的啊？
当然，到了这一步，快速修复方案已经有了，就是把fixed="right"去掉，因此先急忙打了个补丁把线上问题糊上了
连一刻也没有为线上bug哀悼，下一刻赶到战场的是ElTable的源码实现

## 问题原因

打开node_modules\element-ui\packages\table\src, 来看看是怎么个事吧

### ElTableColumn（src\table-column.js）
先来看 ElTableColumn ，可以在created看到fixed在传入后会被设置到this.columnConfig上，并且在registerComplexWatchers设置变化监听，不过由于我代码中是直接赋固定值的，因此只需关注this.columnConfig后续在mounted中被用于owner.store.commit('insertColumn')就行。

### ElTable——Store（src\store\index.js）
上面的store其实在src的store下，实际就是用Vue.extend扩展出了一个Vue实例，起一个状态管理和追踪作用，可以看到insertColumn最终会执行到
```javascript
if (this.table.$ready) { // 这边会在ElTable完成mounted后执行，所以第一轮加载时不会有fixed部分的渲染
  this.updateColumns(); // hack for dynamics insert column
  this.scheduleLayout();
}
```
这边主要关注的还是updateColumns，在src\store\watcher.js中，
```javascript
updateColumns() {
  // 省略部分代码...
  states.fixedColumns = _columns.filter((column) => column.fixed === true || column.fixed === 'left');
  states.rightFixedColumns = _columns.filter((column) => column.fixed === 'right');
  // 省略部分代码...
}
```
这边能看到针对fixed的列会分别被分成fixedColumns和rightFixedColumns，
接下去再来看看ElTable中针对这些列数据的渲染，

### ElTable（src\table.vue）
可以在这边看到computed中设置了映射
```javascript
...mapStates({
  selection: 'selection',
  columns: 'columns',
  tableData: 'data',
  fixedColumns: 'fixedColumns',
  rightFixedColumns: 'rightFixedColumns'
})
```
然后在template中渲染时，默认会渲染一个<table-body\>,但是存在fixedColumns和rightFixedColumns时，分别都会增加一个<table-body\>的渲染

### ElTableBody（src\table-body.js）
而在ElTableBody中，实际使用render函数来渲染了全量数据，这几次的渲染不同只在与根据fixed传入把对应的列隐藏，
其中渲染的关键部分为wrappedRowRender函数，
```javascript
data.reduce((acc, row) => {
  return acc.concat(this.wrappedRowRender(row, acc.length));
}, [])
```
追踪wrappedRowRender，进一步到rowRender函数中，可以看到最终是渲染了表格的一行tr，
而每个单元格cell的渲染则是通过column.renderCell渲染，这个值从哪来呢？
答案是我们开始追踪的 ElTableColumn（src\table-column.js） 中的setColumnRenders，
主要部分如下：
```javascript
column.renderCell = (h, data) => {
  let children = null;
  if (this.$scopedSlots.default) {
    // NOTE：我们主要关注的是这个路径
    children = this.$scopedSlots.default(data);
  } else {
    children = originRenderCell(h, data);
  }
  const prefix = treeCellPrefix(h, data);
  const props = {
    class: 'cell',
    style: {}
  };
  if (column.showOverflowTooltip) {
    props.class += ' el-tooltip';
    props.style = {width: (data.column.realWidth || data.column.width) - 1 + 'px'};
  }
  return (<div { ...props }>
    { prefix }
    { children }
  </div>);
};
```
可以看到，事实上单元格内渲染的是作用域插槽$scopedSlots中的内容，
因此综合前文逻辑，可以得出其实我们写在el-table-column中的内容会被渲染多次，
再看看我们代码中的逻辑
```html
<el-popover
  :ref="'custom-popover'+scope.row.uuid"
  placement="top"
  @show="showChart(scope.row.uuid)"
>
  <child-chart :ref="'childChart'+scope.row.uuid" />
  <i slot="reference" class="el-icon-question"></i>
</el-popover>
```
```javascript
showChart(id) {
  const attr = 'childChart' + id;
  const popperAttr = 'custom-popover' + id;
  if (this.$refs && this.$refs[attr]) {
    this.$refs[attr].showChart().then(() => {
      this.$refs[popperAttr] && this.$refs[popperAttr].updatePopper();
    });
  }
}
```
结合vue中registerRef的实现
```javascript
function registerRef (vnode, isRemoval) {
  var key = vnode.data.ref;
  if (!isDef(key)) { return }

  var vm = vnode.context;
  var ref = vnode.componentInstance || vnode.elm;
  var refs = vm.$refs;
  // 省略部分代码...
  if (vnode.data.refInFor) {
    if (!Array.isArray(refs[key])) {
      refs[key] = [ref];
    } else if (refs[key].indexOf(ref) < 0) {
      // $flow-disable-line
      refs[key].push(ref);
    }
  } else {
    // NOTE：这里是实际走的逻辑
    refs[key] = ref;
  }
  // 省略部分代码...
}
```
由于我们的代码不在v-for中，实际采用的是refs[key] = ref，
因此后一次渲染时，会把之前的refs[key]覆盖掉，
导致最终refs[key]指向的是最后一次数据的组件实例。

## 修复方案

由于会多次渲染，所以可以增加一个自增的属性，从而区分不同的子组件实例，
但是需要注意的是这边并不是第一次生成的实例就是需要的实例，
因为组件在初始实例化时会有多次更新的情况，初始创建的实例可能会变成空，

```javascript
// Vue的源码中
Vue.extend = function (extendOptions) {
    // 省略部分代码...
    var cachedCtors = extendOptions._Ctor || (extendOptions._Ctor = {});
    if (cachedCtors[SuperId]) {
      return cachedCtors[SuperId]
    }

    // 省略部分代码...
    Sub.options = mergeOptions(
      Super.options,
      extendOptions
    );
    // 省略部分代码...
};
```
找到mergeOptions
```javascript
  
function mergeOptions(
  parent,
  child,
  vm
) {
  // 省略部分代码...
  normalizeProps(child, vm);
  // 省略部分代码...
}
```
找到normalizeProps
```javascript
function normalizeProps (options, vm) {
  // 省略部分代码...
  options.props = res; // 这边赋值会触发新的更新
}
```
因此推荐是获取第一次生成的有内容的实例,修改的主要代码如下
```javascript
// 用于每次渲染生成不同id
genId(type, uuid) {
    const key = `${type}-${uuid}`;
    const val = this.idMap.get(key) || 1;
    this.idMap.set(key, val + 1);
    return `${key}-${val}`;
},
showChart(id) {
    // NOTE：
    // ElTable中设置了带fixed的column时，会导致table-body渲染多次（这个是UI库的实现逻辑导致的）
    // 重复渲染会导致表格body中的子组件被多次实例化
    // 前面genId做自增id，这边取id最小的有内容的ref就是为了解决这个问题
    // 需要注意的是如果要获取的子组件位于fixed的column中，那么需要取的实例的id会变化，需要按具体情况分析
    const attr = `childChart-${id}-`;
    const popperAttr = `custom-popover-${id}-`;
    for (let name in this.$refs) {
        if (name.startsWith(attr) && this.$refs[name]) {
            const popperName = popperAttr + name.replace(attr, '');
            const item = this.$refs[name];
            item.showChart().then(() => {
                this.$refs[popperName] && this.$refs[popperName].updatePopper();
            });
        }
    }
}
```
