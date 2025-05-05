---
title: React组件循环渲染问题排查
tags: [React]
categories: [前端]
cover: /images/favicon.png
date: 2025-05-02 12:23:33
toc: true
---
页面卡死。同事：我也没干啥啊，这咋整啊？得，又来活哩
<!-- more -->

## TL;DR;
1.在useEffect里面应该避免setState，即使需要也应该避免把setState放在微任务中调用
2.在React中监听和处理原生事件要慎重
如果你觉得上面的说了等于没说，那还是看看下文的血泪史吧 >.<

## 背景故事

同事说是一个表单写着写着，不知道怎么的，一点按钮就开始页面卡死，通过console打印输出，发现有个useEffect一直被调用，但是不知道问题哪来的。
本来以为是useEffect里面的调用又变更了依赖项，但是打眼这么一瞅啊，我就没看懂。
才没几个月的React项目，已经长出了数十个文件，虽说都是函数组件吧，但是组件间的调用关系已经有些复杂了。
没辙，先让同事讲了下出问题部分的代码位置，然后把代码拉下来慢慢看吧,结果没成想这一看就是两天。

## 1.抽象问题

由于其中部分代码使用到了antd，为避免依赖包的影响，首先尝试在去掉antd的情况下看能否复现问题。
其中主要是用到了antd表单的validateFields()，看调用方式像一个Promise，翻了下源码在[rc-field-form](https://github.com/react-component/field-form/blob/6611c318e39714593243ed623e311d6c2990e510/src/useForm.ts#L962C28-L962C44)里面找到相关[证据](https://github.com/react-component/field-form/blob/6611c318e39714593243ed623e311d6c2990e510/src/utils/asyncUtil.ts#L12)，确实是Promise。
因此实质上可以将validateFields()等价替换为Promise.resolve()
之后再通过抽象简化父子组件互相调用内容，我得到以下简化版的复现Demo组件

[**在线编辑样例**](https://stackblitz.com/edit/vitejs-vite-w6xbf4rv?file=src%2Floop%2FsimpleTest3.tsx)

可以看到，简化后的版本依然能复现问题，因此，后续分析均以简化版本展开

## 2.分析原因

针对代码中setState的部分分别打上断点

![断点图](./images/React组件循环渲染问题排查/断点.png)

可以看到执行顺序为【第45行】->【第48行】->【第26行】->【第21行】，之后按目前的断点，单步执行会一直在【第21行】循环
那么我们可以从上述表现获得那些信息呢？
1. 首先是handleClick目前先于document.body的click导致的onBodyClick执行
2. 目前看循环发生是由【第21行】在useEffect中执行setF1([3])导致的

上述2点发现同时也带来了疑问，为什么会表现为如此呢？
### 2.1 合成事件
关于前面第1点的事件执行顺序问题，其实比较好理解,主要涉及的知识点是React的合成事件。
合成事件是采用事件代理、侦听冒泡到挂载的root节点的事件来实现的，
而绑定到document.body的事件侦听明显是在此之后才能冒泡到，所以合成事件的handleClick先于到达body的原生事件onBodyClick。
关于合成事件的具体实现细节感兴趣的可以移步观看[源码](https://github.com/facebook/react/blob/e9db3cc2d4175849578418a37f33a6fde5b3c6d8/packages/react-dom-bindings/src/events/DOMEventProperties.js#L128)
### 2.2 任务调度
关于第2点发生的原因，其实涉及几个问题：
- setF1后发生了什么？
- 是什么在循环触发【第21行】，换言之，是什么在循环触发useEffect，又是什么在循环变更list？

我们先来分析setF1后发生的事情，通过断点进入下一步即可进入源码
可以发现其实此时是执行了dispatchSetState函数，原因是挂载时[mountState的处理](https://github.com/facebook/react/blob/0db8db178c1521f979535bdba32bf9db9f47ca05/packages/react-reconciler/src/ReactFiberHooks.js#L1925)。
其中内容大致是将当前的setF1操作作为一个update任务挂到更新队列上，并调度任务(scheduleUpdateOnFiber)等待执行，这调度又干了什么呢？
进入scheduleUpdateOnFiber->ensureRootIsScheduled后我们可以看到断点经过以下标红区域，

![调度图](./images/React组件循环渲染问题排查/调度.png)
可以看到React认为当前任务为"同步"，实际通过scheduleMicrotask（实际为queueMicrotask，参考同文件源码）安排了一个微任务更新，
<b>React调度中所谓Sync的更新其实还是采用了异步的微任务（也有可能fallback到setTimeout）来实现的。</b>
同时在这边我们也能看到其他的"异步"任务走了另一条分支scheduleCallback，
实际"异步"任务是通过scheduler包的[unstable_scheduleCallback](https://github.com/facebook/react/blob/e9db3cc2d4175849578418a37f33a6fde5b3c6d8/packages/scheduler/src/forks/Scheduler.js#L327)进行了宏任务调度，事实上scheduleCallback调用时基本没有使用到options参数的情况，因此基本是直接挂了个宏任务，并没有延时的部分，感兴趣的读者可以自行探索其基于小根堆的调度实现。

### 2.3 更新过程
那么这个update的微任务执行的时候具体做了哪些事呢？
我们都知道，更新状态后会重新渲染组件，因此直接把断点加在函数组件进入的首行即可到达渲染组件的时机，此时即为update任务执行的过程中。

![渲染过程图](./images/React组件循环渲染问题排查/渲染过程.png)
我们可以通过上图看到执行栈标识当前updateFunctionComponent的过程是在beginWork发起的
这边简单说明下react中组件的更新流程，更新可以简单分为 [render->commit](https://github.com/facebook/react/blob/1fb18e22ae66fdb1dc127347e169e73948778e5a/packages/react-reconciler/src/ReactFiberWorkLoop.new.js#L1034C10-L1034C31) 2大部分：
- [render](https://github.com/facebook/react/blob/1fb18e22ae66fdb1dc127347e169e73948778e5a/packages/react-reconciler/src/ReactFiberWorkLoop.new.js#L1067)部分主要完成state更新执行、effect任务排队等
- [commit](https://github.com/facebook/react/blob/1fb18e22ae66fdb1dc127347e169e73948778e5a/packages/react-reconciler/src/ReactFiberWorkLoop.new.js#L1107)部分主要完成effect任务的执行、重置优先级、重置全局变量等

以上部分均可以通过在useState和useEffect的回调部分加断点调试进入源码进行验证。

### 2.4 推理过程
按照我们的分析，前文【第26行】setList实际是安排了一个微任务来更新当前组件，而微任务中具体执行的就是组件更新流程：
- render阶段：执行组件函数，执行useState时由于list上存在的任务，导致setList回调函数被再次执行，产生了新的list值，并将effect的回调函数被添加到待执行队列
- commit阶段：执行useEffect的回调，但是由于setF1写是在Promise.resolve()后再调用的，所以setF1安排的更新任务实际是在performSyncWorkOnRoot所有同步内容完成后才执行，之后setF1会安排新一次的微任务更新组件。

循环时会反复执行到【第21行】setF1部分，看上去应该是新产生的组件更新重复被触发，导致前面的步骤循环。

---
推论到此产生了一个疑问：按理来说，setF1安排的更新应该不涉及list更新，也就是setF1安排组件更新后应该不再会触发list变更，也就不可能再走到【第21行】setF1部分。
但是我们实际看到的表现是依赖list的useEffect每次都执行了回调，那么问题出在哪里呢？

让我们再仔细debugger一下Demo中setList的回调执行过程，可以看到【第27行】回调函数被执行完成后，对应hook的待执行队列并未清空。

![setList的回调](./images/React组件循环渲染问题排查/setList的回调.gif)
原因在于【第48行】setList添加的任务为低优先级任务，不执行，但被保留下来了，而【第26行】setList由于添加任务在【第48行】之后，因此即使执行了，也被保留了。另外注意这边hook.baseState在循环中也一直都是[3]，因为React认为当前的状态更新类似于过渡态，为了保障最终状态的正确性，react的选择是保留了从暂未执行的update开始的状态和之后的所有操作，便于后续继续重新计算出最新的状态值（从这个角度看，react的状态管理有点像拿数据库日志做数据恢复的过程）。

![hook针对queue的优先级处理](./images/React组件循环渲染问题排查/hook针对queue的优先级处理.png)
再结合【第15行】useEffect针对依赖项是否产生变化的判断，可以看到【第26行】setList的回调每次都产生了新值，导致useEffect的回调会被执行到。

![useEffect添加effectList过程](./images/React组件循环渲染问题排查/useEffect添加effectList过程.png)
之后再来到【第21行】setF1部分，按前文2.3 任务调度部分的分析，setF1始终触发微任务调度更新组件，整个循环就串上了。


### 2.5 推导原因
由于前面的推导过程比较长，为了便于理解，这边重新做下整体过程的梳理：

![整体分析推导](./images/React组件循环渲染问题排查/整体分析推导.png)

1. 根容器上响应click触发handleClick进行setF2；同时click进一步冒泡到body，安排了下一个宏任务。
2. setF2安排了Sync的微任务执行更新渲染，从而走了【第48行】setList，此时处于flushPassiveEffects执行过程当中，此时变更list产生的更新，Lane优先级为DefaultEventPriority，从而使得任务的调度优先级为NormalSchedulerPriority，就先存了一个低优先级的宏任务在hook的queue上，等待后续执行。

  ![useEffect内回调的优先级设置](./images/React组件循环渲染问题排查/useEffect内回调的优先级设置.png)
3. 下一个宏任务触发onBodyClick执行【第26行】setList产生的更新Lane优先级为SyncLane，就又存了一个高优先级的任务在hook的queue上，并安排了Sync的微任务更新渲染。
4. 微任务更新时先render，走【第11行】useState时，发现当前hook.queue上存在2个update，但是第一个是低优先，先保留不执行；第二个是高优先级任务，执行，但是由于前面有低优先级任务，也需要保留。此时hook.queue就没有被清理。
5. 后续更新时走commit阶段，在commitRootImpl阶段，由于满足SyncLane条件导致effect回调被同步执行

  ![同步effect回调被执行的时机](./images/React组件循环渲染问题排查/同步effect回调被执行的时机.gif)
6. 同步执行回调时由于setF1([3])是在Promise.resolve()之后的，currentUpdatePriority已被重制，所以setF1添加的更新与第2步不同，此时添加的更新优先级等同于当前body.click事件的优先级，lane属于同步（高优先级），因此后续添加一个Sync的微任务更新渲染。

  ![setF1的更新lane优先级](./images/React组件循环渲染问题排查/setF1的更新lane优先级.gif)
7. 由于前文已经提到，list这个hook.queue没有被清理，因此后一次渲染会重复4-6的步骤，导致微任务一直产生，就卡这了

事实上这一切主要原因来自于React的任务优先级及调度设计
## 3.修复方案
完成理论分析后，我们需要给出合适的解决方案，上述问题的关键在于调用onBodyClick后，程序困在了微任务循环当中。
因此需要解决问题，就需要【避免产生】或者【打破】这个微任务循环。
由于原始代码中onBodyClick与handleClick并无执行顺序要求，因此笔者采用的思路是仅调整onBodyClick，从源头避免产生这类循环。
由于该问题出现的必要条件是onBodyClick内触发setList前存在一个允许延时执行的任务，
因此让onBodyClick在没有其他延时任务时触发即可避免，
所以可以简单的调整原生事件监听为捕获阶段，即可将原生事件的触发提前到合成事件前，如下
```javascript
useEffect(() => {
  const temp = onBodyClick
  document.body.addEventListener('click', temp, true);
  return () => {
    document.body.removeEventListener('click', temp, true);
  }
}, []);
```

## 4.附言/吐槽
本次bug的调试体验实在谈不上友好。
由于React库复杂的优先级设置和任务调度实现，细粒度的任务拆分让执行栈信息变得很零碎，给调试代码和问题定位带来了相当的困难。
笔者也花了相当的时间来梳理整个过程，中间debugger花费的时间远超编写复现demo的时间。
虽然这个库叫React，但其状态更新的实现并不响应式，非要说的话更像是快照（snapshot）。
虽然其调度函数上有分"同步"(Sync)和"异步"(Concurrent),但在实现时却变成了微任务（queueMicrotask）和宏任务（MessageChannel）。
这个库给我的感觉就是拧巴：为了解决单次更新量过大页面冻结的问题，不是尝试减少更新量，而是引入并发做延时更新；
由于并发实现上的架构复杂性，导致实际上最终完成整体更新时执行的工作量比原本更多，调试更难，而使用者收获的是什么呢？

> 仅仅是界面更新可能不那么容易冻结了。

笔者本人就咸鱼一条，认识有限，但还是想吐槽几句( ˶´⚰︎`˵ )，
私以为这很难说是一种正确的设计思路和发展方向：
- 对于设计者而言，这种解决问题的方式是否是"用战术上的勤奋掩盖战略上的懒惰"？
- 对于用户而言，这种库的实现方案在使用上是否是易用易维护，稳定，高性能的？ 

---
最后就是一些经验教训：
- 既然已经在使用React库了，应当尽量让库来接手Event监听和处理，避免自己监听原生事件；
- useEffect中避免变更state，特别不要在微任务中去做变更；

否则出现类似本次的问题需要花费较多的人力投入分析，反而吃力不讨好。