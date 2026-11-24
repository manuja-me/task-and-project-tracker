import { test, expect } from "@playwright/test";

test.describe("Two-Person Handover Acceptance Journey", () => {
  test("Owner assigns, teammate completes, owner observes progress & activity, outsider isolated", async ({
    browser,
  }) => {
    const timestamp = Date.now();
    const projName = `Handover Project ${timestamp}`;
    const taskTitle = `Demo Handover Task ${timestamp}`;

    // 1. Context A: Project Owner
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    await ownerPage.goto("/login");
    await ownerPage.fill("#username", "owner");
    await ownerPage.fill("#password", "demo12345");
    await ownerPage.click('button[type="submit"]');

    await expect(ownerPage).toHaveURL(/.*\/projects/);
    await expect(ownerPage.locator("text=Signed in as owner")).toBeVisible();

    // Owner creates new project
    await ownerPage.click("text=+ New Project");
    await ownerPage.fill("#new-project-name", projName);
    await ownerPage.fill("#new-project-desc", "Acceptance journey project");
    await ownerPage.click('button[type="submit"]:has-text("Create Project")');

    // Open project
    await expect(ownerPage.locator(`text=${projName}`)).toBeVisible();
    await ownerPage.click(`text=${projName}`);
    await expect(ownerPage).toHaveURL(/.*\/projects\/[0-9a-f-]+/);
    const projectUrl = ownerPage.url();

    // Add teammate in Members tab (scoped inside .card)
    await ownerPage.locator('.card a', { hasText: /^Members$/ }).click();
    await ownerPage.fill('input[placeholder*="username"]', "teammate");
    await ownerPage.click('button:has-text("Add Member")');
    await expect(ownerPage.locator("td:has-text('teammate')")).toBeVisible();

    // Return to Tasks and assign task to teammate
    await ownerPage.locator('.card a', { hasText: /^Tasks$/ }).click();
    await ownerPage.click("text=+ New Task");
    await ownerPage.fill("#task-title", taskTitle);
    await ownerPage.fill("#task-desc", "Prepare final presentation notes");
    await ownerPage.selectOption("#task-assignee", { label: "teammate (member)" });
    await ownerPage.click('button[type="submit"]:has-text("Create Task")');

    await expect(ownerPage.locator(`text=${taskTitle}`)).toBeVisible();
    await expect(ownerPage.locator("text=0%")).toBeVisible();

    // 2. Context B: Teammate
    const teammateContext = await browser.newContext();
    const teammatePage = await teammateContext.newPage();

    await teammatePage.goto("/login");
    await teammatePage.fill("#username", "teammate");
    await teammatePage.fill("#password", "demo12345");
    await teammatePage.click('button[type="submit"]');

    await expect(teammatePage).toHaveURL(/.*\/projects/);

    // Teammate opens My Tasks from top navbar
    await teammatePage.locator('.nav-links a', { hasText: /^My Tasks$/ }).click();
    await expect(teammatePage.locator(`text=${taskTitle}`)).toBeVisible();

    // Teammate opens task and updates status: TODO -> IN_PROGRESS -> DONE
    await teammatePage.locator('a', { hasText: new RegExp(`^${taskTitle}$`) }).click();
    await expect(teammatePage).toHaveURL(/.*\/tasks\/[0-9a-f-]+/);
    await expect(teammatePage.locator('h1', { hasText: taskTitle })).toBeVisible();
    await expect(teammatePage.locator(".badge-todo")).toBeVisible();

    await teammatePage.click('button:has-text("Move to In Progress")');
    await expect(teammatePage.locator(".badge-inprogress")).toBeVisible();

    await teammatePage.click('button:has-text("Move to Done")');
    await expect(teammatePage.locator(".badge-done")).toBeVisible();

    // 3. Owner checks updated progress
    await ownerPage.bringToFront();
    await ownerPage.reload();
    await expect(ownerPage.locator("text=100%")).toBeVisible();

    // Owner checks Activity
    await ownerPage.locator('.card a', { hasText: /^Activity$/ }).click();
    await expect(ownerPage.locator("text=teammate").first()).toBeVisible();
    await expect(ownerPage.locator("text=updated task").first()).toBeVisible();

    // 4. Context C: Outsider
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();

    await outsiderPage.goto("/login");
    await outsiderPage.fill("#username", "outsider");
    await outsiderPage.fill("#password", "demo12345");
    await outsiderPage.click('button[type="submit"]');

    await expect(outsiderPage).toHaveURL(/.*\/projects/);
    await expect(
      outsiderPage.locator(".card h3").or(outsiderPage.getByRole("heading", { name: "No projects yet" })).first()
    ).toBeVisible();
    await expect(outsiderPage.locator(`text=${projName}`)).not.toBeVisible();

    // Outsider checks My Tasks
    await outsiderPage.locator('.nav-links a', { hasText: /^My Tasks$/ }).click();
    await expect(
      outsiderPage.locator("table.table").or(outsiderPage.getByRole("heading", { name: "You have no assigned tasks" })).first()
    ).toBeVisible();
    await expect(outsiderPage.locator(`text=${taskTitle}`)).not.toBeVisible();

    // Direct URL access to owner's project returns 404 isolation error
    await outsiderPage.goto(projectUrl);
    await expect(outsiderPage.getByRole("alert")).toContainText(/Project not found/i);

    await ownerContext.close();
    await teammateContext.close();
    await outsiderContext.close();
  });
});
