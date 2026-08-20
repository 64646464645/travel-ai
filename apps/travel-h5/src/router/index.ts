import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/",
    name: "home",
    component: () => import("@/views/Home.vue"),
  },
  {
    path: "/chat",
    name: "chat",
    component: () => import("@/views/Chat.vue"),
  },
  {
    path: "/sessions",
    name: "sessions",
    component: () => import("@/views/Sessions.vue"),
  },
  {
    path:"/profile",
    name:"profile",
    component: () => import("@/views/Profile.vue"),
  },
  {
    path: "/detail",
    name: "detail",
    component: () => import("@/views/Detail.vue"),
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
