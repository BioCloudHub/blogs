import { defineAsyncComponent } from "vue";
import { defineClientConfig } from "vuepress/client";

import SearchPageButton from "./components/SearchPageButton.vue";
import CategoryList from "./components/CategoryList.vue";
import TagList from "./components/TagList.vue";

export default defineClientConfig({
  enhance({ app }) {
    /* Only used on the homepage — lazy-load to keep GSAP out of main bundle */
    app.component(
      "HomeHero",
      defineAsyncComponent(() => import("./components/HomeHero.vue")),
    );
    app.component(
      "HomePipeline",
      defineAsyncComponent(() => import("./components/HomePipeline.vue")),
    );

    /* Used globally */
    app.component("SearchPageButton", SearchPageButton);
    app.component("CategoryList", CategoryList);
    app.component("TagList", TagList);
  },
});
