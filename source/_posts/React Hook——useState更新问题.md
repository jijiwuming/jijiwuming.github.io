---
title: React Hook——useState更新问题
tags: [React]
categories: [前端]
cover: /images/favicon.png
date: 2025-02-04 17:23:41
---
近期遇到了一个自增id的问题，看了半天才想明白，React还是不太熟
<!-- more -->
## 问题表现

有个列表需要key值，但是后端数据在业务上是可能重复的。同事加了个自增id，粗看之下代码好像没啥问题，但是跑起来就是没有自增的效果。由于初看时表现确实比较诡异，所以为了方便理解，下面放上复现样例（不开启严格模式）

[**在线编辑样例**](https://stackblitz.com/edit/vitejs-vite-w6xbf4rv?file=src%2Ftest1.tsx)

## 问题代码

让我们先来看下代码
```javascript
function getSomeValue() {
  let val = 1;
  return function () {
    return ++val;
  };
}
```
代码中实现了一个闭包函数，闭包函数的处理逻辑也不难理解，每次调用会使得返回值增加1。

接下去，再来一个简单的React组件，进行一个PPAP式的组合
```jsx
import { useState } from 'react';
function getSomeValue() {
  let val = 1;
  return function () {
    return ++val;
  };
}
const Test: React.FC = () => {
  const init = getSomeValue();
  const [state, setState] = useState(init);
  const handleClick = () => {
    setState(init);
  };
  return <div onClick={handleClick}>{state}</div>;
};
export default Test;
```

如果有不了解初始化函数的读者，可以参考[官网文档](https://react.dev/reference/react/useState#parameters)说明。

不难看到文档中对于初始化函数提出了几点要求：纯函数(pure),无入参(take no arguments)。组件初始化时React会调用初始化函数，以调用的返回值作为初始的state值。

明显上述函数init并非纯函数，违反了文档对于初始化函数的要求。

## 问题复现

接下去让我们点击下这个组件，这时候事情就变得诡异起来了：

初始化组件时触发一次调用，所以一开始界面会展示值2，这个比较好理解。点击一下变成3，也没啥，正常。

但是接下去每次点击却是 2 2 3 2 2 3....

这事情一下就诡异起来了。

让我们一点点来理解一下，首次展示的2以及点击一次后的3都好理解，触发一次调用就累加1，

但是后面的2 2 3是为啥呢？

## 分析过程

我们都知道React的函数组件在每次更新state的时候其实是重新执行了一遍整个函数。
因此，函数组件内部的代码在每次更新state时会重新执行，因此每次更新state后，init函数都是新生成的。
但是分析到这儿，华生会发现第二个盲点，按照这样的分析，合理的表现应该是后续一直展示2，这边的2 2 3是怎么来的呢？

诶，这就是最离谱的地方，[React官方文档](https://react.dev/reference/react/useState#ive-updated-the-state-but-the-screen-doesnt-update)其实有提到一点，
在更新前后的State相同时，React将会忽略更新。

- a.假设当前点击了一次，界面展示3，之后再点击第2次，由于之前函数组件重新执行过，界面展示为2。
- b.点击第3次，之前函数组件重新执行过，新值应该还是2，界面展示为2，但是注意这边新值和旧值相同，react跳过了实际 DOM 更新。
- c.由于前一次点击State相同时忽略更新事实上会导致上一次的init被保留下来。点击第4次时，使用的init实际是第2次点击完后的init，按照闭包的特性，被保留的init下一次被调用时将递增为3，作为新值触发setState，界面展示为3。
- d.而由于前一次的新值3与旧值2的不同，就不会忽略组件更新，函数组件又被执行过了，init再次被刷新，下一次点击调用就再变为 2，相当于又回到了a步骤的结束

之后的更新就都在这个循环中，由此，点击结果就在2 2 3中反复循环。

可以看到
> 每一个神秘表现的背后，必然是某些实现上的 hack <del>（PS：React的 hack 未免也多了点）</del>

## 修复方案

在了解了原因之后，其实修改代码就是相对简单的事情了。事实上，我们只需要修改一行代码的位置即可。

```jsx
import { useState } from 'react';
function getSomeValue() {
  let val = 1;
  return function () {
    return ++val;
  };
}
const init = getSomeValue();
const Test: React.FC = () => {
  const [state, setState] = useState(init);
  const handleClick = () => {
    setState(init);
  };
  return <div onClick={handleClick}>{state}</div>;
};
export default Test;
```
这样一来，init就是一个固定的函数，不会随着函数组件的更新而变化了，也就实现了自增的效果

BTW，私以为这部分代码可作为面试题纳入题库。