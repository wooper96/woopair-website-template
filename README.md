# WooPair league website

1. On GitHub, choose **Use this template** and create a **public** repository with `main` as its default branch.
2. In your new repository, open **Settings → Pages** and choose **GitHub Actions** as the source.
3. In WooPair, open the league setup, choose the repository, enter your league's public name, and select **Connect league**. Once the app verifies the website, the league settings will show its public address.

Invite tournament organizers as collaborators with write access. They can connect the prepared repository in WooPair and leave the new website name blank.

If setup or a tournament update is waiting for the website, use **Open Pages workflow** in WooPair to see the deployment status. Select **Run workflow** on `main` to retry the current site, then select **Check again** in WooPair.

The homepage lists current and completed tournaments. Open an event to browse the roster, numbered rounds and official standings as WooPair publishes them. The website reads `league.json` and the files in `data/tournaments/` at runtime.

The Pages workflow installs the locked dependencies, builds the React site, and packages the build with the published data. To check and build the template locally, use Node.js 24 and run `npm ci`, `npm run check`, `npm test`, and `npm run build` in the template directory. To include runtime league data in a local preview, run `python3 .github/scripts/package-pages.py /tmp/woopair-league-preview` after building and serve that output with an HTTP server.
