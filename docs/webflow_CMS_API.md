---
title: Webflow CMS API
description: Learn how to interact with the Webflow CMS using the Data API.
hidden: false
layout: reference
subtitle: Manage your Webflow CMS content using the Data API
---

Webflow's CMS API lets you programmatically create, manage, and publish content. Use it to build custom workflows, integrate with external systems, and automate content management. For general information on the Webflow CMS, see the [help center documentation](https://help.webflow.com/hc/en-us/articles/33961307099027-Intro-to-the-Webflow-CMS).

## Overview
Use the Data API to manage three core components of the Webflow CMS:

<CardGroup cols={3}>
    <Card
        title="Collections"
        href="#collections"
    >
        Database-like containers that define content structure and fields.
    </Card>
    <Card
        title="Fields"
        href="#collection-fields"
    >
        Individual data fields that define content types within a collection.
    </Card>
    <Card
        title="Items"
        href="#collection-items"
    >
        Content records stored within a collection.
    </Card>
</CardGroup>

The API supports both **staged** and **live** content, giving you precise control over your [publishing workflow](/data/docs/working-with-the-cms/publishing). You can create content programmatically, perform bulk updates, and manage multi-locale content.

---

## Workflows 

There are a few workflows that are particularly helpful to understand when working with the CMS API.

<CardGroup cols={2} id="workflow-cards">
    <Card
        title="Collection Management"
        href="/data/docs/working-with-the-cms/manage-collections-and-items"
        iconPosition="left"
        iconSize="12"
        icon={
            <>
                <img src="https://dhygzobemt712.cloudfront.net/Icons/Dark/64px/CMS.svg" alt="" className="hidden dark:block" />
                <img src="https://dhygzobemt712.cloudfront.net/Icons/Light/64px/CMS.svg" alt="" className="block dark:hidden" />
            </>
        }
    >
        Learn how to create, manage, and publish collections and items.
    </Card>
    <Card
        title="Publishing"
        href="/data/docs/working-with-the-cms/publishing"
        data-path="publishing"
        iconPosition="left"
        iconSize="12"
        icon={
            <>
                <img src="https://dhygzobemt712.cloudfront.net/Icons/Dark/64px/PublishDesigner.svg" alt="" className="hidden dark:block" />
                <img src="https://dhygzobemt712.cloudfront.net/Icons/Light/64px/PublishDesigner.svg" alt="" className="block dark:hidden" />
            </>
        }
    >
        Learn how items are published, updated, and unpublished.
    </Card>
    <Card
        title="Localization"
        href="/data/docs/working-with-the-cms/localization"
        data-path="cms-localization"
        iconPosition="left"
        iconSize="12"
        icon={
            <>
                <img src="https://dhygzobemt712.cloudfront.net/Icons/Dark/64px/Localization.svg" alt="" className="hidden dark:block" />
                <img src="https://dhygzobemt712.cloudfront.net/Icons/Light/64px/Localization.svg" alt="" className="block dark:hidden" />
            </>
        }
    >
        Learn how to create and manage linked CMS items across multiple locales.
    </Card>
    <Card
        title="Content Delivery"
        href="/data/docs/working-with-the-cms/content-delivery"
        data-path="cms-cdn" 
        iconPosition="left"
        iconSize="12"
        icon={
            <>
                <img src="https://dhygzobemt712.cloudfront.net/Icons/Dark/64px/GlobalCDN.svg" alt="" className="hidden dark:block" />
                <img src="https://dhygzobemt712.cloudfront.net/Icons/Light/64px/GlobalCDN.svg" alt="" className="block dark:hidden" />
            </>
        }
    >
        Learn how to deliver cached content to external applications.
    </Card>
</CardGroup>

---

## Key concepts

<Accordion title="Collections">
Collections are structured containers for dynamic content, similar to database tables. Each collection defines a content type, like blog posts, team members, or testimonials, by specifying a set of fields.

Collections can contain various [field types](/data/reference/field-types-item-values), including text, rich text, images, dates, numbers, and references to other collections.

Each collection has a unique ID used to manage its details, fields, and items.

### Collections endpoints

| Endpoint | Description |
|----------|-------------|
|  <span data-badge-type="http-method" data-http-method="GET" class="fern-docs-badge small green subtle shrink-0">GET</span> [List collections](/data/reference/cms/collections/list) | Retrieve all collections for a site. |
|  <span data-badge-type="http-method" data-http-method="GET" class="fern-docs-badge small green subtle shrink-0">GET</span> [Get collection](/data/reference/cms/collections/get) | Retrieve the schema and details for a specific collection. |
|  <span data-badge-type="http-method" data-http-method="POST" class="fern-docs-badge small blue subtle shrink-0">POST</span> [Create collection](/data/reference/cms/collections/create) | Create a new collection. |
|  <span data-badge-type="http-method" data-http-method="DELETE" class="fern-docs-badge small red subtle shrink-0">DELETE</span> [Delete collection](/data/reference/cms/collections/delete) | Remove a collection and all of its items. |
<br/>
</Accordion>
<Accordion title="Collection fields">
Fields define the structure and data type for content in a collection. Each field has a unique ID used to manage its details and item data. Each field's type determines the kind of content it can store. See the [field types reference](/data/reference/field-types-item-values) for a full list of types and their properties.  

### Collection fields endpoints

| Endpoint | Description |
|----------|-------------|
|  <span data-badge-type="http-method" data-http-method="POST" class="fern-docs-badge small blue subtle shrink-0">POST</span> [Create field](/data/reference/cms/collection-fields/create) | Create a new field in a collection. |
|  <span data-badge-type="http-method" data-http-method="PATCH" class="fern-docs-badge small orange subtle shrink-0">PATCH</span> [Update field](/data/reference/cms/collection-fields/update) | Modify an existing field. |
|  <span data-badge-type="http-method" data-http-method="DELETE" class="fern-docs-badge small red subtle shrink-0">DELETE</span> [Delete field](/data/reference/cms/collection-fields/delete) | Remove a field from a collection. |

<Note title="List fields">
    To list fields, retrieve collection details using the [get collection](/data/reference/cms/collections/get) endpoint.
</Note>

</Accordion>
<Accordion title="Collection items">
Items are individual records within a collection. Each item has a unique ID and contains data for the fields defined in that collection.

### Collection Item states
Items exist in two main states:
<CardGroup>
    <Card
        title="Staged"
    >
        Draft content not visible on your live site.
    </Card>
    <Card
        title="Live"
    >
        Published content that appears on your website.
    </Card>
</CardGroup>

This dual-state system lets you prepare content changes without affecting your live site. You can create, edit, and preview staged content before publishing. For more details, see the [CMS publishing guide](/data/docs/working-with-the-cms/publishing).


### Collection items endpoints

<Tabs>
    <Tab title="Staged">

    Manage staged items on a site. These endpoints also work with live items. Updating a live item automatically updates its staged version. Creating a new item with these endpoints always creates a draft.

        | Endpoint | Description |
        |----------|-------------|
        | <span data-badge-type="http-method" data-http-method="GET" class="fern-docs-badge small green subtle shrink-0">GET</span> [List items](/data/reference/cms/collection-items/staged-items/list-items) | Retrieve a list of all items in a collection. |
        | <span data-badge-type="http-method" data-http-method="GET" class="fern-docs-badge small green subtle shrink-0">GET</span> [Get item](/data/reference/cms/collection-items/staged-items/get-item) | Retrieve a specific item. |
        | <span data-badge-type="http-method" data-http-method="POST" class="fern-docs-badge small blue subtle shrink-0">POST</span> [Create item(s)](/data/reference/cms/collection-items/staged-items/create-items) | Create items. Use `cmsLocaleIds` to create items across multiple locales. |
        | <span data-badge-type="http-method" data-http-method="PUT" class="fern-docs-badge small orange subtle shrink-0">PATCH</span> [Update items](/data/reference/cms/collection-items/staged-items/update-items) | Modify one or more items. |
        | <span data-badge-type="http-method" data-http-method="POST" class="fern-docs-badge small red subtle shrink-0">DELETE</span> [Delete items](/data/reference/cms/collection-items/staged-items/delete-items) | Delete one or more items. |
        | <span data-badge-type="http-method" data-http-method="POST" class="fern-docs-badge small blue subtle shrink-0">POST</span> [Publish item](/data/reference/cms/collection-items/staged-items/publish-item) | Publish one or more items. |

        <Note title="Unpublish items">
            Use the [unpublish live item endpoint](/data/reference/cms/collection-items/live-items/delete-items-live) to unpublish a live item.
        </Note>
    </Tab>

    <Tab title="Live">
        Manage live items on a site. These endpoints only work for live items.

        | Endpoint | Description |
        |----------|-------------|
        | <span data-badge-type="http-method" data-http-method="GET" class="fern-docs-badge small green subtle shrink-0">GET</span> [List live items](/data/reference/cms/collection-items/live-items/list-items-live) | Retrieve a list of all live items in a collection. |
        | <span data-badge-type="http-method" data-http-method="GET" class="fern-docs-badge small green subtle shrink-0">GET</span> [Get live item](/data/reference/cms/collection-items/live-items/get-item-live) | Retrieve a specific live item. |
        | <span data-badge-type="http-method" data-http-method="POST" class="fern-docs-badge small blue subtle shrink-0">POST</span> [Create items](/data/reference/cms/collection-items/live-items/create-item-live) | Create new live items. |
        | <span data-badge-type="http-method" data-http-method="PUT" class="fern-docs-badge small orange subtle shrink-0">PATCH</span> [Update items](/data/reference/cms/collection-items/live-items/update-items-live) | Modify one or more live items. |
        | <span data-badge-type="http-method" data-http-method="POST" class="fern-docs-badge small red subtle shrink-0">DELETE</span> [Unpublish items](/data/reference/cms/collection-items/live-items/delete-items-live) | Unpublish one or more live items. |
        | <span data-badge-type="http-method" data-http-method="POST" class="fern-docs-badge small blue subtle shrink-0">POST</span> [Publish item](/data/reference/cms/collection-items/staged-items/publish-item) | Publish one or more live items. |
    </Tab>
</Tabs>

</Accordion>

---
## Start working with the CMS API
Below is an interactive tutorial that will walk you through the basic steps of getting a collection, listing a collection schema, listing collection items, and creating a collection item.

<iframe style={{width:"100%", height:"650px"}} src="https://my-astro-app.victoria-l-plummer.workers.dev" />

## Bulk operations

For most CMS operations, the API provides both single-item and bulk endpoints. Bulk endpoints allow you to perform `CRUD` operations (Create, Read, Update, Delete) on multiple items in a single API call, which is more efficient for managing content at scale.

<Note>
    To keep the sidebar clean, we've hidden most single-item endpoints. However, they are fully functional and not deprecated. The tables below show both the visible and hidden endpoints for staged and live collection items.
</Note>

<Accordion title="Staged Items">

| Operation | Single Item Endpoint | Bulk Endpoint |
|---|---|---|
| **List** | [`GET /collections/{collection_id}/items`](/data/v2.0.0/reference/cms/collection-items/staged-items/list-items) | N/A |
| **Get** | [`GET /collections/{collection_id}/items/{item_id}`](/data/v2.0.0/reference/cms/collection-items/staged-items/get-item) | N/A |
| **Create** | [`POST /collections/{collection_id}/items`](/data/v2.0.0/reference/cms/collection-items/staged-items/create-item) | [`POST /collections/{collection_id}/items/bulk`](https://developers.webflow.com/data/v2.0.0/reference/cms/collection-items/staged-items/create-items) |
| **Update** | [`PATCH /collections/{collection_id}/items/{item_id}`](/data/v2.0.0/reference/cms/collection-items/staged-items/update-item) | [`PATCH /collections/{collection_id}/items`](/data/v2.0.0/reference/cms/collection-items/staged-items/update-items) |
| **Delete** | [`DELETE /collections/{collection_id}/items/{item_id}`](/data/v2.0.0/reference/cms/collection-items/staged-items/delete-item) | [`DELETE /collections/{collection_id}/items`](/data/v2.0.0/reference/cms/collection-items/staged-items/delete-items) |
| **Publish** | N/A | [`POST /collections/{collection_id}/items/publish`](/data/v2.0.0/reference/cms/collection-items/staged-items/publish-item) |
</Accordion>

<Accordion title="Live Items">
| Operation | Single Item Endpoint | Bulk Endpoint |
|---|---|---|
| **List** | [`GET /collections/{collection_id}/items/live`](/data/v2.0.0/reference/cms/collection-items/live-items/list-items-live) | N/A |
| **Get** | [`GET /collections/{collection_id}/items/{item_id}/live`](/data/v2.0.0/reference/cms/collection-items/live-items/get-item-live) | N/A |
| **Create** | [`POST /collections/{collection_id}/items/live`](/data/v2.0.0/reference/cms/collection-items/live-items/create-item-live) | N/A |
| **Update** | [`PATCH /collections/{collection_id}/items/{item_id}/live`](data/v2.0.0/reference/cms/collection-items/live-items/update-item-live) | [`PATCH /collections/{collection_id}/items/live`](/data/v2.0.0/reference/cms/collection-items/live-items/update-items-live) |
| **Unpublish**| [`DELETE /collections/{collection_id}/items/{item_id}/live`](/https://developers.webflow.com/data/v2.0.0/reference/cms/collection-items/live-items/delete-item-live) | [`DELETE /collections/{collection_id}/items/live`](/data/v2.0.0/reference/cms/collection-items/live-items/delete-items-live) |
</Accordion>

## Webhooks

Use webhooks to receive real-time notifications about changes to your content. This enables automated workflows and integrations with other systems.

### Webhook events

[Create a webhook](/data/reference/webhooks/create) and subscribe to the following events for a given collection:

- [Collection item created](/data/reference/webhooks/events/collection-item-created)
- [Collection item updated](/data/reference/webhooks/events/collection-item-changed)
- [Collection item deleted](/data/reference/webhooks/events/collection-item-deleted)
- [Collection item published](/data/reference/webhooks/events/collection-item-published)
- [Collection item un-published](/data/reference/webhooks/events/collection-item-unpublished)

## Next Steps

<CardGroup cols={2}>
    <Card
        title="Getting started"
        href="/data/docs/working-with-the-cms/manage-collections-and-items"
    >
        Create a collection, add fields, and create items. Includes pagination examples.
    </Card>
    <Card
        title="Working with webhooks"
        href="/data/docs/working-with-webhooks"
    >
        Set up real-time notifications for content changes to build automated workflows.
    </Card>
</CardGroup>
