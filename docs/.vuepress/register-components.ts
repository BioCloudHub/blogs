import { defineClientConfig } from "vuepress/client";

import CategoryList from "./components/CategoryList.vue";
import HomeBio3D from "./components/HomeBio3D.vue";
import SearchPageButton from "./components/SearchPageButton.vue";
import SearchWorkspace from "./components/SearchWorkspace.vue";
import TagList from "./components/TagList.vue";

export default defineClientConfig({
  enhance({ app }) {
    app.component("CategoryList", CategoryList);
    app.component("HomeBio3D", HomeBio3D);
    app.component("SearchPageButton", SearchPageButton);
    app.component("SearchWorkspace", SearchWorkspace);
    app.component("TagList", TagList);
  },
});
