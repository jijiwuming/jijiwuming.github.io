---
title: el-dialog在数组中的更新问题
tags: [vue 2, element-ui]
categories: [前端]
---

老项目的弹窗展示后无法更新列表数据了
<!-- more -->

## 问题表现

公司的项目还在使用 Vue 2 和 element-ui ，在实现功能时发现了一个奇怪的问题，点开弹窗后再更新列表数据，列表数据不展示了。

![列表不展示](./images/el-dialog在数组中的更新问题/列表不展示.webp)

## TL;DR

element-ui中ElDialog的appendToBody的实现采用了将DOM节点挂载到document.body的方式，会导致ElDialog的DOM的父节点变为document.body，而 VUE 2 在列表中插入元素时，会判断被插入的节点的父DOM节点是否与列表包裹的DOM节点一致，由于上述实现会导致新增的元素无法插入到ElDialog前，从而导致在列表更新时异常

## 复现问题

原项目组件比较复杂，通过几次尝试，发现通过 watch 可以看到 Vue 是监听到了数据变更的。这就有点奇怪了，如果监听到了数据变化，正常就应该渲染成对应的Dom节点，但是实际并没有，看上去似乎是在实际diff渲染时出现了问题

> PS: 以下均以事后简化复现的示例进行讲解

## 复现代码

参考[problem-reproduction](https://github.com/jijiwuming/problem-reproduction/blob/main/src/components/list-with-dialog.vue)

也可尝试[在线编辑](https://stackblitz.com/edit/vue2-problem?file=src%2Fcomponents%2Flist-with-dialog.vue)

### 1. 添加断点

初步判断是组件更新过程中产生异常导致的，为了查找异常更新的原因，需要添加断点，但是不能直接添加普通的断点，因为直接添加断点每次更新都会被触发，太多的断点会导致无法找到有效的信息，我们知道vue的更新时机在nextTick时，通过flushSchedulerQueue执行watcher来完成，因此可以在flushSchedulerQueue过程中的watcher.run()添加断点，并且组件的更新渲染是通过渲染watcher（RenderWatcher）来实现的，那么找到合适的RenderWatcher就变得尤为重要，由于RenderWatcher在构建时有传入特殊标识isRenderWatcher，可以看到Watcher创建对应的逻辑，
```javascript
this.vm = vm;
if (isRenderWatcher) {
  vm._watcher = this;
}
// ...
this.expression = process.env.NODE_ENV !== 'production'
    ? expOrFn.toString()
    : '';
// parse expression for getter
if (typeof expOrFn === 'function') {
  this.getter = expOrFn;
}
```
用watcher.vm._watcher === watcher来区分 RenderWatcher,其次我们应该需要找到的是列表父元素的更新，因此需要针对该元素过滤,由于RenderWatcher.vm即为组件，因此过滤 watcher.vm.$el.className==='list-wrapper'，触发到watcher.run()的断点后，可以看到对应watcher的表达式expression如下
```javascript
function () {vm._update(vm._render(), hydrating);}
```
结合上文中可以知道，事实上这就是创建watcher时传入的expOrFn，而实际watcher.run执行的时候会执行watcher的getter
```javascript
Watcher.prototype.get = function get() {
  pushTarget(this);
  var value;
  var vm = this.vm;
  try {
    value = this.getter.call(vm, vm);
  } catch (e) {
    // ...
  } finally {
    // ...
  }
  return value
};
```
可以看到实际就是执行了这个expOrFn，因此下一步需要找到_render和_update分析逻辑，由于_render主要负责完成vnode的创建，_update主要完成vnode到实际dom的patch，
```javascript
vm.$el = vm.__patch__(prevVnode, vnode);
```
因此我们将断点添加到_update入口，根据生成完的vnode来判断问题具体出现在以上2步中的哪一步，事实上这边可以看到生成的vnode中children数量是正确的，即使不愿相信，但是问题大概率出现在了生成实际dom的过程中，接下去，跟随__patchch__,可以一步步走到patch(oldVnode, vnode, hydrating, removeOnly)中的patchVnode
```javascript
var isRealElement = isDef(oldVnode.nodeType);
if (!isRealElement && sameVnode(oldVnode, vnode)) {
  // patch existing root node
  patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly);
}
```
进入patchVnode，接下去可以看到走入到updateChildren，在下文添加断点
```javascript
while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx){
  // ...
}
```
最后可以看到while循环走完后没有问题，就是完成了首部和尾部dialog的比对，正常进入了下边的逻辑
```javascript
if (oldStartIdx > oldEndIdx) {
  refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm;
  addVnodes(parentElm, refElm, newCh, newStartIdx, newEndIdx, insertedVnodeQueue);
}
```
说明此时vnode的diff更新并没有问题，但是界面上却没有出现该有的新元素，为啥呢？
往下走，进入addVnodes函数
```javascript
function addVnodes(parentElm, refElm, vnodes, startIdx, endIdx, insertedVnodeQueue) {
  for (; startIdx <= endIdx; ++startIdx) {
    createElm(vnodes[startIdx], insertedVnodeQueue, parentElm, refElm, false, vnodes, startIdx);
  }
}
```
此时的startIdx与endIdx相等，创建的正是新加入的那一项，没毛病啊，接着走入createElm，
最终会跟着断点走入到这一行，作用是插入本次新增的组件的dom节点到指定的parentElm下的refElm前
```javascript
 insert(parentElm, vnode.elm, refElm);
```
接下去来看看insert函数内部
```javascript
function insert(parent, elm, ref$$1) {
  if (isDef(parent)) {
    if (isDef(ref$$1)) {
      if (nodeOps.parentNode(ref$$1) === parent) {
        nodeOps.insertBefore(parent, elm, ref$$1);
      }
    } else {
      nodeOps.appendChild(parent, elm);
    }
  }
}
```
此时parent是列表的包裹项，ref$$1是dialog组件的dom节点，逻辑走入下面这部分
```javascript
// 这边nodeOps.parentNode(ref$$1)其实就是ref$$1.parentNode
// 参考
// function parentNode(node) {
//   return node.parentNode
// }
if (nodeOps.parentNode(ref$$1) === parent) {
  nodeOps.insertBefore(parent, elm, ref$$1);
}
```
至此，真相已经浮出水面，nodeOps.parentNode(ref$$1)是什么呢?
由于dialog设置了append-to-body，导致nodeOps.parentNode(ref$$1)对应的是body元素，
而parent却是列表的包裹项，nodeOps.parentNode(ref$$1) === parent判断不通过，所以实际dom并没有被插入
至此，我们已经找到了列表不更新问题的直接原因，然而，仍然有一朵乌云萦绕在我心头:为什么会在弹窗打开过后才出现这个问题呢？
再来看element-ui中对于ElDialog的实现,找到node_modules\element-ui\lib\element-ui.common.js
搜索ElDialog看看，
```javascript
 watch: {
    visible: function visible(val) {
      var _this = this;

      if (val) {
        // ....
        if (this.appendToBody) {
          document.body.appendChild(this.$el);
        }
      } else {
        // ...
      }
    }
  },
  mounted: function mounted() {
    if (this.visible) {
      // ...
      if (this.appendToBody) {
        document.body.appendChild(this.$el);
      }
    }
  },
```
醍醐灌顶啊兄弟们，带有appendToBody的ElDialog会被移动到到body下，但是这个操作不是一开始就操作的，而是在首次打开后才触发的

牢记血泪教训：
> 在基于前端框架的开发中，应尽量避免越过框架直接操作DOM元素