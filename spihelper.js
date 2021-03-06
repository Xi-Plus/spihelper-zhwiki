// <nowiki>
// Forked from https://github.com/GeneralNotability/spihelper
// @ts-check
// GeneralNotability's rewrite of Tim's SPI helper script
// With contributions from Dreamy Jazz, L235, Tamzin, TheresNoTime
// v2.7.1 "Counting forks"

/* global mw, $, displayMessage, spiHelperCustomOpts, wgULS */

// Adapted from [[User:Mr.Z-man/closeAFD]]
mw.loader.load('https://en.wikipedia.org/w/index.php?title=User:GeneralNotability/spihelper.css&action=raw&ctype=text/css', 'text/css')
mw.loader.load('https://en.wikipedia.org/w/index.php?title=User:Timotheus_Canens/displaymessage.js&action=raw&ctype=text/javascript')

// Typedefs
/**
 * @typedef SelectOption
 * @type {Object}
 * @property {string} label Text to display in the drop-down
 * @property {string} value Value to return if this option is selected
 * @property {boolean} selected Whether this item should be selected by default
 * @property {boolean=} disabled Whether this item should be disabled
 */

/**
 * @typedef BlockEntry
 * @type {Object}
 * @property {string} username Username to block
 * @property {string} duration Duration of block
 * @property {boolean} acb If set, account creation is blocked
 * @property {boolean} ab Whether autoblock is enabled (for registered users)/
 *     logged-in users are blocked (for IPs)
 * @property {boolean} ntp If set, talk page access is blocked
 * @property {boolean} nem If set, email access is blocked
 * @property {string} tpn Type of talk page notice to apply on block
 */

/**
 * @typedef TagEntry
 * @type {Object}
 * @property {string} username Username to tag
 * @property {string} tag Tag to apply to user
 * @property {string} altmasterTag Altmaster tag to apply to user, if relevant
 * @property {boolean} blocking Whether this account is marked for block as well
 */

/**
  * @typedef ParsedArchiveNotice
  * @type {Object}
  * @property {string} username Case username
  * @property {boolean} xwiki Whether the crosswiki flag is set
  * @property {boolean} deny Whether the deny flag is set
  * @property {boolean} notalk Whether the notalk flag is set
  * @property {string} lta LTA page name
  */

// Globals

/* User setting related globals */

// User-configurable settings, these are the defaults but will be updated by
// spiHelperLoadSettings()
const spiHelperSettings = {
  // Choices are 'watch' (unconditionally add to watchlist), 'preferences'
  // (follow default preferences), 'nochange' (don't change the watchlist
  // status of the page), and 'unwatch' (unconditionally remove)
  watchCase: 'preferences',
  watchCaseExpiry: 'indefinite',
  watchArchive: 'nochange',
  watchArchiveExpiry: 'indefinite',
  watchTaggedUser: 'preferences',
  watchTaggedUserExpiry: 'indefinite',
  watchNewCats: 'nochange',
  watchNewCatsExpiry: 'indefinite',
  watchBlockedUser: true,
  watchBlockedUserExpiry: 'indefinite',
  // Lets people disable clerk options if they're not a clerk
  clerk: false,
  // Log all actions to Special:MyPage/spihelper_log
  log: false,
  // Reverse said log, so that the newest actions are at the top.
  reversed_log: false,
  // Enable the "move section" button
  iUnderstandSectionMoves: false,
  // Automatically tick the "Archive case" option if the case is closed
  tickArchiveWhenCaseClosed: true,
  // These are for debugging to view as other roles. If you're picking apart the code and
  // decide to set these (especially the CU option), it is YOUR responsibility to make sure
  // you don't do something that violates policy
  debugForceCheckuserState: null,
  debugForceAdminState: null
}

// Valid options for spiHelperSettings. Prevents invalid setting options being specified in the spioptions user subpage.
// This method only works options with discrete possible values. As such the expiry options will need to be accomodated for in spiHelperLoadSettings() via a check
// that validates it is a valid expiry option.
const spiHelperValidSettings = {
  watchCase: ['preferences', 'watch', 'nochange', 'unwatch'],
  watchArchive: ['preferences', 'watch', 'nochange', 'unwatch'],
  watchTaggedUser: ['preferences', 'watch', 'nochange', 'unwatch'],
  watchNewCats: ['preferences', 'watch', 'nochange', 'unwatch'],
  watchBlockedUser: ['preferences', 'watch', 'nochange', 'unwatch'],
  clerk: [true, false],
  log: [true, false],
  reversed_log: [true, false],
  iUnderstandSectionMoves: [true, false],
  tickArchiveWhenCaseClosed: [true, false],
  debugForceCheckuserState: [null, true, false],
  debugForceAdminState: [null, true, false]
}

const spiHelperSettingsNeedingValidDate = [
  'watchCaseExpiry',
  'watchArchiveExpiry',
  'watchTaggedUserExpiry',
  'watchNewCatsExpiry',
  'watchBlockedUserExpiry'
]

/* Globals to describe the current SPI page */

/** @type {string} Name of the SPI page in wiki title form
 * (e.g. Wikipedia:Sockpuppet investigations/Test) */
let spiHelperPageName = mw.config.get('wgPageName').replace(/_/g, ' ')

/** @type {number} The main page's ID - used to check if the page
 * has been edited since we opened it to prevent edit conflicts
 */
let spiHelperStartingRevID = mw.config.get('wgCurRevisionId')

const spiHelperIsThisPageAnArchive = mw.config.get('wgPageName').match('Wikipedia:????????????/??????/.*/??????.*')

/** @type {string} Just the username part of the case */
let spiHelperCaseName

if (spiHelperIsThisPageAnArchive) {
  spiHelperCaseName = spiHelperPageName.replace(/Wikipedia:????????????\/??????\//g, '').replace(/\/??????.*/, '')
} else {
  spiHelperCaseName = spiHelperPageName.replace(/Wikipedia:????????????\/??????\//g, '')
}

/** list of section IDs + names corresponding to separate investigations */
let spiHelperCaseSections = []

/** @type {?number} Selected section, "null" means that we're opearting on the entire page */
let spiHelperSectionId = null

/** @type {?string} Selected section's name (e.g. "10 June 2020") */
let spiHelperSectionName = null

/** @type {ParsedArchiveNotice} */
let spiHelperArchiveNoticeParams

/** Map of top-level actions the user has selected */
const spiHelperActionsSelected = {
  Case_act: false,
  Block: false,
  Links: false,
  Note: false,
  Close: false,
  Rename: false,
  Archive: false,
  SpiMgmt: false
}

/** @type {BlockEntry[]} Requested blocks */
const spiHelperBlocks = []

/** @type {TagEntry[]} Requested tags */
const spiHelperTags = []

/** @type {string[]} Requested global locks */
const spiHelperGlobalLocks = []

// Count of unique users in the case (anything with a checkuser, checkip, user, ip, or vandal template on the page) for the block view
let spiHelperBlockTableUserCount = 0
// Count of unique users in the case (anything with a checkuser, checkip, user, ip, or vandal template on the page) for the link view (seperate needed as extra rows can be added)
let spiHelperLinkTableUserCount = 0

// The current wiki's interwiki prefix
const spiHelperInterwikiPrefix = spiHelperGetInterwikiPrefix()

// Map of active operations (used as a "dirty" flag for beforeunload)
// Values are strings representing the state - acceptable values are 'running', 'success', 'failed'
const spiHelperActiveOperations = new Map()

/* Globals to describe possible options for dropdown menus */

/** @type {SelectOption[]} List of possible selections for tagging a user in the block/tag interface
 */
const spiHelperTagOptions = [
  { label: wgULS('???', '???'), selected: true, value: '' },
  { label: wgULS('???????????????', '???????????????'), value: 'blocked', selected: false },
  { label: wgULS('???????????????', '???????????????'), value: 'proven', selected: false },
  { label: wgULS('?????????????????????', '?????????????????????'), value: 'confirmed', selected: false },
  { label: wgULS('????????????????????????', '????????????????????????'), value: 'master', selected: false },
  { label: wgULS('??????????????????????????????', '??????????????????????????????'), value: 'sockmasterchecked', selected: false }
  // { label: '3X banned master', value: 'bannedmaster', selected: false }
]

/** @type {SelectOption[]} List of possible selections for tagging a user's altmaster in the block/tag interface */
// const spiHelperAltMasterTagOptions = [
//   { label: wgULS('???', '???'), selected: true, value: '' },
//   { label: wgULS('?????????????????????????????????', '?????????????????????????????????'), value: 'suspected', selected: false },
//   { label: wgULS('?????????????????????????????????', '?????????????????????????????????'), value: 'proven', selected: false }
// ]

/** @type {SelectOption[]} List of templates that CUs might insert */
const spiHelperCUTemplates = [
  { label: wgULS('???????????????', '???????????????'), selected: true, value: '', disabled: true },
  { label: wgULS('?????????', '?????????'), selected: false, value: '{{confirmed}}' },
  { label: wgULS('?????????/????????????', '?????????/????????????'), selected: false, value: '{{confirmed-nc}}' },
  { label: wgULS('????????????', '????????????'), selected: false, value: '{{tallyho}}' },
  { label: '?????????', selected: false, value: '{{likely}}' },
  { label: wgULS('????????????????????????', '????????????????????????'), selected: false, value: '{{possilikely}}' },
  { label: '??????', selected: false, value: '{{possible}}' },
  { label: '????????????', selected: false, value: '{{unlikely}}' },
  { label: wgULS('?????????', '?????????'), selected: false, value: '{{unrelated}}' },
  { label: wgULS('?????????', '?????????'), selected: false, value: '{{inconclusive}}' },
  { label: wgULS('????????????????????????', '????????????????????????'), selected: false, value: '{{behav}}' },
  // { label: 'No sleepers', selected: false, value: '{{nosleepers}}' },
  { label: wgULS('????????????', '????????????'), selected: false, value: '{{Stale}}' }
  // { label: 'No comment (IP)', selected: false, value: '{{ncip}}' },
]

/** @type {SelectOption[]} Templates that a clerk or admin might insert */
const spiHelperAdminTemplates = [
  { label: wgULS('?????????/????????????', '?????????/????????????'), selected: true, value: '', disabled: true },
  { label: '????????????', selected: false, value: '{{duck}}' },
  { label: wgULS('?????????????????????', '?????????????????????'), selected: false, value: '{{megaphoneduck}}' },
  { label: wgULS('?????????IP', '?????????IP'), selected: false, value: '{{IPblock}}' },
  { label: wgULS('??????????????????', '??????????????????'), selected: false, value: '{{Blockedandtagged}}' },
  { label: wgULS('?????????????????????', '?????????????????????'), selected: false, value: '{{Blockedwithouttags}}' },
  { label: wgULS('????????????????????????', '????????????????????????'), selected: false, value: '{{sblock}}' },
  { label: wgULS('???????????????????????????', '???????????????????????????'), selected: false, value: '{{Blockedtaggedclosing}}' },
  { label: wgULS('?????????????????????????????????', '?????????????????????????????????'), selected: false, value: '{{Action and close}}' },
  { label: wgULS('??????????????????', '??????????????????'), selected: false, value: '{{DiffsNeeded|moreinfo}}' },
  { label: wgULS('??????', '??????'), selected: false, value: '{{Close}}' }
  // { label: 'Locks requested', selected: false, value: '{{GlobalLocksRequested}}' },
]

/* Globals for regexes */

// Regex to match the case status, group 1 is the actual status
const spiHelperCaseStatusRegex = /{{\s*SPI case status\s*\|?\s*(\S*?)\s*}}/i
// Regex to match closed case statuses (close or closed)
const spiHelperCaseClosedRegex = /^closed?$/i

const spiHelperClerkStatusRegex = /{{(CURequest|awaitingadmin|clerk ?request|(?:self|requestand|cu)?endorse|inprogress|clerk ?decline|decline-ip|moreinfo|relisted|onhold)}}/i

const spiHelperSockSectionWithNewlineRegex = /====\s*????????????\s*====\n*/i

const spiHelperAdminSectionWithPrecedingNewlinesRegex = /\n*\s*====\s*???????????????????????????????????????????????????\s*====\s*/i

const spiHelperCUBlockRegex = /{{(checkuserblock(-account|-wide)?|checkuser block)}}/i

const spiHelperArchiveNoticeRegex = /{{\s*SPI\s*archive notice\|(?:1=)?([^|]*?)(\|.*)?}}/i

const spiHelperPriorCasesRegex = /{{spipriorcases}}/i

const spiHelperSectionRegex = /^(?:===[^=]*===|=====[^=]*=====)\s*$/m

// regex to remove hidden characters from form inputs - they mess up some things,
// especially mw.util.isIP
const spiHelperHiddenCharNormRegex = /\u200E/g

/* Other globals */

/** @type{string} Advert to append to the edit summary of edits */
const spihelperAdvert = '?????????[[:w:zh:User:Xiplus/js/spihelper|spihelper]]???'

/** Protection for userpage of blocked users */
const spiBlockedUserpageProtection = [
  { type: 'edit', level: 'sysop', expiry: 'infinity' },
  { type: 'move', level: 'sysop', expiry: 'infinity' }
]

/* Used by the link view */
const spiHelperLinkViewURLFormats = {
  editorInteractionAnalyser: { baseurl: 'https://sigma.toolforge.org/editorinteract.py', appendToQueryString: '', userQueryStringKey: 'users', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'Editor Interaction Anaylser' },
  interactionTimeline: { baseurl: 'https://interaction-timeline.toolforge.org/', appendToQueryString: 'wiki=enwiki', userQueryStringKey: 'user', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'Interaction Timeline' },
  timecardSPITools: { baseurl: 'https://spi-tools.toolforge.org/spi/timecard/' + spiHelperCaseName, appendToQueryString: '', userQueryStringKey: 'users', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'Timecard comparisons' },
  consolidatedTimelineSPITools: { baseurl: 'https://spi-tools.toolforge.org/spi/timecard/' + spiHelperCaseName, appendToQueryString: '', userQueryStringKey: 'users', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'Consolidated Timeline (requires login)' },
  pagesSPITools: { baseurl: 'https://spi-tools.toolforge.org/spi/timeline/' + spiHelperCaseName, appendToQueryString: '', userQueryStringKey: 'users', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'SPI Tools Pages (requires login)' },
  checkUserWikiSearch: { baseurl: 'https://checkuser.wikimedia.org/w/index.php', appendToQueryString: 'ns0=1', userQueryStringKey: 'search', userQueryStringSeparator: ' OR ', userQueryStringWrapper: '"', multipleUserQueryStringKeys: false, name: 'Checkuser wiki search' }
}

/* Actually put the portlets in place if needed */
if (mw.config.get('wgPageName').includes('Wikipedia:????????????/??????/')) {
  mw.loader.load('mediawiki.user')
  mw.loader.load('ext.gadget.site-lib')
  $(spiHelperAddLink)
}

// Main functions - do the meat of the processing and UI work

const spiHelperTopViewHTML = `
<div id="spiHelper_topViewDiv">
  <h3>` + wgULS('??????SPI??????', '??????SPI??????') + `</h3>
  <select id="spiHelper_sectionSelect"></select>
  <h4 id="spiHelper_warning" class="spihelper-errortext" hidden></h4>
  <ul>
    <li id="spiHelper_actionLine"  class="spiHelper_singleCaseOnly spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Case_Action" id="spiHelper_Case_Action" />
      <label for="spiHelper_Case_Action">` + wgULS('??????????????????', '??????????????????') + `</label>
    </li>
    <li id="spiHelper_spiMgmtLine"  class="spiHelper_allCasesOnly">
      <input type="checkbox" id="spiHelper_SpiMgmt" />
      <label for="spiHelper_SpiMgmt">` + wgULS('??????SPI??????', '??????SPI??????') + `</label>
    </li>
    <li id="spiHelper_blockLine" class="spiHelper_adminClerkClass">
      <input type="checkbox" name="spiHelper_BlockTag" id="spiHelper_BlockTag" />
      <label for="spiHelper_BlockTag">` + wgULS('??????/????????????', '??????/????????????') + `</label>
    </li>
    <li id="spiHelper_userInfoLine" class="spiHelper_singleCaseOnly">
      <input type="checkbox" name="spiHelper_userInfo" id="spiHelper_userInfo" />
      <label for="spiHelper_userInfo">` + wgULS('????????????', '????????????') + `</label>
    </li>
    <li id="spiHelper_commentLine" class="spiHelper_singleCaseOnly spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Comment" id="spiHelper_Comment" />
      <label for="spiHelper_Comment">??????</label>
    </li>
    <li id="spiHelper_closeLine" class="spiHelper_adminClerkClass spiHelper_singleCaseOnly spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Close" id="spiHelper_Close" />
      <label for="spiHelper_Close">` + wgULS('????????????', '????????????') + `</label>
    </li>
    <li id="spiHelper_moveLine" class="spiHelper_clerkClass spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Move" id="spiHelper_Move" />
      <label for="spiHelper_Move" id="spiHelper_moveLabel">` + wgULS('??????/????????????????????????????????????', '??????/????????????????????????????????????') + `</label>
    </li>
    <li id="spiHelper_archiveLine" class="spiHelper_clerkClass spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Archive" id="spiHelper_Archive"/>
      <label for="spiHelper_Archive">` + wgULS('??????????????????????????????', '??????????????????????????????') + `</label>
    </li>
  </ul>
  <input type="button" id="spiHelper_GenerateForm" name="spiHelper_GenerateForm" value="` + wgULS('??????', '??????') + `" />
</div>
`

/**
 * Initialization functions for spiHelper, displays the top-level menu
 */
async function spiHelperInit () {
  'use strict'
  spiHelperCaseSections = await spiHelperGetInvestigationSectionIDs()

  // Load archivenotice params
  spiHelperArchiveNoticeParams = await spiHelperParseArchiveNotice(spiHelperPageName.replace(/\/??????.*/, ''))

  // First, insert the template text
  displayMessage(spiHelperTopViewHTML)

  // Narrow search scope
  const $topView = $('#spiHelper_topViewDiv', document)

  if (spiHelperArchiveNoticeParams.username === null) {
    // No archive notice was found
    const $warningText = $('#spiHelper_warning', $topView)
    $warningText.show()
    $warningText.append($('<b>').text(wgULS('?????????????????????????????????????????????????????????????????????', '?????????????????????????????????????????????????????????????????????')))
    const newArchiveNotice = spiHelperMakeNewArchiveNotice(spiHelperCaseName, { xwiki: false, deny: false, notalk: false, lta: '' })
    let pagetext = await spiHelperGetPageText(spiHelperPageName, false)
    if (spiHelperPriorCasesRegex.exec(pagetext) === null) {
      pagetext = '{{SPIpriorcases}}\n' + pagetext
    }
    pagetext = newArchiveNotice + '\n' + pagetext
    if (pagetext.indexOf('__TOC__') === -1) {
      pagetext = '<noinclude>__TOC__</noinclude>\n' + pagetext
    }
    await spiHelperEditPage(spiHelperPageName, pagetext, wgULS('??????????????????', '??????????????????'), false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)
  }

  // Next, modify what's displayed
  // Set the block selection label based on whether or not the user is an admin
  $('#spiHelper_blockLabel', $topView).text(spiHelperIsAdmin() ? wgULS('??????/????????????', '??????/????????????') : wgULS('????????????', '????????????'))

  // Wire up a couple of onclick handlers
  $('#spiHelper_Move', $topView).on('click', function () {
    spiHelperUpdateArchive()
  })
  $('#spiHelper_Archive', $topView).on('click', function () {
    spiHelperUpdateMove()
  })

  // Generate the section selector
  const $sectionSelect = $('#spiHelper_sectionSelect', $topView)
  $sectionSelect.on('change', () => {
    spiHelperSetCheckboxesBySection()
  })

  // Add the dates to the selector
  for (let i = 0; i < spiHelperCaseSections.length; i++) {
    const s = spiHelperCaseSections[i]
    $('<option>').val(s.index).text(s.line).appendTo($sectionSelect)
  }
  // All-sections selector...deliberately at the bottom, the default should be the first section
  $('<option>').val('all').text(wgULS('????????????', '????????????')).appendTo($sectionSelect)

  updateForRole($topView)

  // Only show options suitable for the archive subpage when running on the archives
  if (spiHelperIsThisPageAnArchive) {
    $('.spiHelper_notOnArchive', $topView).hide()
  }
  // Set the checkboxes to their default states
  spiHelperSetCheckboxesBySection()

  $('#spiHelper_GenerateForm', $topView).one('click', () => {
    spiHelperGenerateForm()
  })
}

const spiHelperActionViewHTML = `
<div id="spiHelper_actionViewDiv">
  <small><a id="spiHelper_backLink">` + wgULS('??????????????????', '??????????????????') + `</a></small>
  <br />
  <h3>` + wgULS('??????SPI??????', '??????SPI??????') + `</h3>
  <div id="spiHelper_actionView">
    <h4>` + wgULS('??????????????????', '??????????????????') + `</h4>
    <label for="spiHelper_CaseAction">` + wgULS('????????????', '????????????') + `</label>
    <select id="spiHelper_CaseAction"></select>
  </div>
  <div id="spiHelper_spiMgmtView">
    <h4>` + wgULS('??????SPI??????', '??????SPI??????') + `</h4>
    <ul>
      <li>
        <input type="checkbox" id="spiHelper_spiMgmt_crosswiki" />
        <label for="spiHelper_spiMgmt_crosswiki">???wiki??????</label>
      </li>
      <li>
        <input type="checkbox" id="spiHelper_spiMgmt_deny" />
        <label for="spiHelper_spiMgmt_deny">` + wgULS('??????en:WP:DENY??????????????????', '??????en:WP:DENY??????????????????') + `</label>
      </li>
      <li>
        <input type="checkbox" id="spiHelper_spiMgmt_notalk" />
        <label for="spiHelper_spiMgmt_notalk">` + wgULS('??????????????????????????????????????????????????????????????????????????????', '??????????????????????????????????????????????????????????????????????????????') + `</label>
      </li>
      <li>
        <label for="spiHelper_moveTarget">` + wgULS('LTA???????????????', 'LTA???????????????') + `</label>
        <input type="text" name="spiHelper_spiMgmt_lta" id="spiHelper_spiMgmt_lta" />
      </li>
    </ul>
  </div>
  <div id="spiHelper_sockLinksView">
    <h4 id="spiHelper_sockLinksHeader">` + wgULS('??????????????????', '??????????????????') + `</h4>
    <table id="spiHelper_userInfoTable" style="border-collapse:collapse;">
      <tr>
        <th>` + wgULS('?????????', '???????????????') + `</th>
        <th><span title="Editor interaction analyser" class="rt-commentedText spihelper-hovertext">Interaction analyser</span></th>
        <th><span title="Interaction timeline" class="rt-commentedText spihelper-hovertext">Interaction timeline</span></th>
        <th><span title="Timecard comparison - SPI tools" class="rt-commentedText spihelper-hovertext">Timecard</span></th>
        <th class="spiHelper_adminClass"><span title="Consolidated timeline (login needed) - SPI tools" class="rt-commentedText spihelper-hovertext">Consolidated timeline</span></th>
        <th class="spiHelper_adminClass"><span title="Pages - SPI tools (login needed)" class="rt-commentedText spihelper-hovertext">Pages</span></th>
        <th class="spiHelper_cuClass"><span title="CheckUser wiki search" class="rt-commentedText spihelper-hovertext">CU wiki</span></th>
      </tr>
      <tr style="border-bottom:2px solid black">
        <td style="text-align:center;">` + wgULS('??????????????????', '?????????????????????') + `</td>
        <td style="text-align:center;"><input type="checkbox" id="spiHelper_link_editorInteractionAnalyser"/></td>
        <td style="text-align:center;"><input type="checkbox" id="spiHelper_link_interactionTimeline"/></td>
        <td style="text-align:center;"><input type="checkbox" id="spiHelper_link_timecardSPITools"/></td>
        <td style="text-align:center;" class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_link_consolidatedTimelineSPITools"/></td>
        <td style="text-align:center;" class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_link_pagesSPITools"/></td>
        <td style="text-align:center;" class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_link_checkUserWikiSearch"/></td>
      </tr>
    </table>
    <span><input type="button" id="moreSerks" value="????????????" onclick="spiHelperAddBlankUserLine('block');"/></span>
  </div>
  <div id="spiHelper_blockTagView">
    <h4 id="spiHelper_blockTagHeader">` + wgULS('?????????????????????', '?????????????????????') + `</h4>
    <ul>
      <li class="spiHelper_adminClass">
        <input type="checkbox" name="spiHelper_noblock" id="spiHelper_noblock" />
        <label for="spiHelper_noblock">` + wgULS('????????????????????????????????????????????????????????????????????????', '????????????????????????????????????????????????????????????????????????') + `</label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" checked="checked" name="spiHelper_override" id="spiHelper_override" />
        <label for="spiHelper_override">` + wgULS('???????????????????????????', '???????????????????????????') + `</label>
      </li>
      <li class="spiHelper_clerkClass">
        <input type="checkbox" name="spiHelper_tagAccountsWithoutLocalAccount" id="spiHelper_tagAccountsWithoutLocalAccount" />
        <label for="spiHelper_tagAccountsWithoutLocalAccount">` + wgULS('??????????????????????????????????????????', '??????????????????????????????????????????') + `</label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" name="spiHelper_blockSummaryNoLink" id="spiHelper_blockSummaryNoLink" />
        <label for="spiHelper_blockSummaryNoLink">` + wgULS('????????????????????????????????????', '????????????????????????????????????') + `???WP:DENY???</label>
      </li>
      <li class="spiHelper_cuClass">
        <input type="checkbox" name="spiHelper_cublock" id="spiHelper_cublock" />
        <label for="spiHelper_cublock">` + wgULS('???????????????????????????', '??????????????????????????????') + `</label>
      </li>
      <li class="spiHelper_cuClass">
        <input type="checkbox" name="spiHelper_cublockonly" id="spiHelper_cublockonly" />
        <label for="spiHelper_cublockonly">
          ` + wgULS('??????????????????????????????????????????{{checkuserblock-account}}???{{checkuserblock}}???????????????????????????????????????????????????????????????', '??????????????????????????????????????????{{checkuserblock-account}}???{{checkuserblock}}??????????????????????????????????????????????????????????????????') + `
        </label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" name="spiHelper_blocknoticemaster" id="spiHelper_blocknoticemaster" />
        <label for="spiHelper_blocknoticemaster">` + wgULS('???????????????????????????????????????', '???????????????????????????????????????') + `</label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" name="spiHelper_blocknoticesocks" id="spiHelper_blocknoticesocks" />
        <label for="spiHelper_blocknoticesocks">` + wgULS('????????????????????????????????????', '????????????????????????????????????') + `</label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" name="spiHelper_blanktalk" id="spiHelper_blanktalk" />
        <label for="spiHelper_blanktalk">` + wgULS('??????????????????????????????????????????', '??????????????????????????????????????????') + `</label>
      </li>
      <li>
        <input type="checkbox" name="spiHelper_hidelocknames" id="spiHelper_hidelocknames" />
        <label for="spiHelper_hidelocknames">` + wgULS('????????????????????????????????????', '??????????????????????????????????????????') + `</label>
      </li>
    </ul>
    <table id="spiHelper_blockTable" style="border-collapse:collapse;">
      <tr>
        <th>` + wgULS('?????????', '???????????????') + `</th>
        <th class="spiHelper_adminClass"><span title="` + wgULS('????????????', '???????????????') + '" class="rt-commentedText spihelper-hovertext">' + wgULS('??????', '??????') + `</span></th>
        <th class="spiHelper_adminClass"><span title="` + wgULS('????????????', '????????????') + `" class="rt-commentedText spihelper-hovertext">??????</span></th>
        <th class="spiHelper_adminClass"><span title="` + wgULS('??????????????????', '??????????????????') + '" class="rt-commentedText spihelper-hovertext">' + wgULS('??????', '??????') + `</span></th>
        <th class="spiHelper_adminClass"><span title="` + wgULS('??????????????????????????????/???????????????????????????IP???', '??????????????????????????????/??????????????????????????????IP???') + '" class="rt-commentedText spihelper-hovertext">' + wgULS('??????/??????', '??????/??????') + `</span></th>
        <th class="spiHelper_adminClass"><span title="` + wgULS('?????????????????????', '?????????????????????') + '" class="rt-commentedText spihelper-hovertext">' + wgULS('??????', '??????') + `</span></th>
        <th class="spiHelper_adminClass"><span title="` + wgULS('????????????????????????', '????????????????????????') + '" class="rt-commentedText spihelper-hovertext">' + wgULS('??????', '??????') + `</span></th>
        <th>` + wgULS('??????', '??????') + `</th>
        <th><span title="` + wgULS('???Meta:SRG??????????????????', '???Meta:SRG??????????????????') + '" class="rt-commentedText spihelper-hovertext">' + wgULS('??????', '??????') + `</span></th>
      </tr>
      <tr style="border-bottom:2px solid black">
        <td style="text-align:center;">` + wgULS('??????????????????', '?????????????????????') + `</td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_doblock"/></td>
        <td class="spiHelper_adminClass"></td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_acb" checked="checked"/></td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_ab" checked="checked"/></td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_tp"/></td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_email"/></td>
        <td><select id="spiHelper_block_tag"></select></td>
        <td><input type="checkbox" name="spiHelper_block_lock_all" id="spiHelper_block_lock"/></td>
      </tr>
    </table>
    <span><input type="button" id="moreSerks" value="????????????" onclick="spiHelperAddBlankUserLine('block');"/></span>
  </div>
  <div id="spiHelper_closeView">
    <h4>` + wgULS('????????????????????????', '????????????????????????') + `</h4>
    <input type="checkbox" checked="checked" id="spiHelper_CloseCase" />
    <label for="spiHelper_CloseCase">` + wgULS('??????SPI??????', '??????SPI??????') + `</label>
  </div>
  <div id="spiHelper_moveView">
    <h4 id="spiHelper_moveHeader">` + wgULS('????????????', '????????????') + `</h4>
    <label for="spiHelper_moveTarget">` + wgULS('???????????????????????????', '?????????????????????????????????') + `</label>
    <input type="text" name="spiHelper_moveTarget" id="spiHelper_moveTarget" />
    <br />
    <input type="checkbox" checked="checked" id="spiHelper_AddOldName" />
    <label for="spiHelper_AddOldName">` + wgULS('????????????????????????', '????????????????????????') + `</label>
  </div>
  <div id="spiHelper_archiveView">
    <h4>` + wgULS('????????????', '????????????') + `</h4>
    <input type="checkbox" checked="checked" name="spiHelper_ArchiveCase" id="spiHelper_ArchiveCase" />
    <label for="spiHelper_ArchiveCase">` + wgULS('?????????SPI??????', '?????????SPI??????') + `</label>
  </div>
  <div id="spiHelper_commentView">
    <h4>??????</h4>
    <span>
      <select id="spiHelper_noteSelect"></select>
      <select class="spiHelper_adminClerkClass" id="spiHelper_adminSelect"></select>
      <select class="spiHelper_cuClass" id="spiHelper_cuSelect"></select>
    </span>
    <div>
      <label for="spiHelper_CommentText">?????????</label>
      <textarea rows="3" cols="80" id="spiHelper_CommentText">* </textarea>
      <div><a id="spiHelper_previewLink">` + wgULS('??????', '??????') + `</a></div>
    </div>
    <div class="spihelper-previewbox" id="spiHelper_previewBox" hidden></div>
  </div>
  <input type="button" id="spiHelper_performActions" value="??????" />
</div>
`
/**
 * Big function to generate the SPI form from the top-level menu selections
 *
 * Would fail ESlint no-unused-vars due to only being
 * referenced in an onclick event
 *
 * @return {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
async function spiHelperGenerateForm () {
  'use strict'
  spiHelperBlockTableUserCount = 0
  spiHelperLinkTableUserCount = 0
  const $topView = $('#spiHelper_topViewDiv', document)
  spiHelperActionsSelected.Case_act = $('#spiHelper_Case_Action', $topView).prop('checked')
  spiHelperActionsSelected.Block = $('#spiHelper_BlockTag', $topView).prop('checked')
  spiHelperActionsSelected.Link = $('#spiHelper_userInfo', $topView).prop('checked')
  spiHelperActionsSelected.Note = $('#spiHelper_Comment', $topView).prop('checked')
  spiHelperActionsSelected.Close = $('#spiHelper_Close', $topView).prop('checked')
  spiHelperActionsSelected.Rename = $('#spiHelper_Move', $topView).prop('checked')
  spiHelperActionsSelected.Archive = $('#spiHelper_Archive', $topView).prop('checked')
  spiHelperActionsSelected.SpiMgmt = $('#spiHelper_SpiMgmt', $topView).prop('checked')
  const pagetext = await spiHelperGetPageText(spiHelperPageName, false, spiHelperSectionId)
  if (!(spiHelperActionsSelected.Case_act ||
    spiHelperActionsSelected.Note || spiHelperActionsSelected.Close ||
    spiHelperActionsSelected.Archive || spiHelperActionsSelected.Block || spiHelperActionsSelected.Link ||
    spiHelperActionsSelected.Rename || spiHelperActionsSelected.SpiMgmt)) {
    displayMessage('')
    return
  }

  displayMessage(spiHelperActionViewHTML)

  // Reduce the scope that jquery operates on
  const $actionView = $('#spiHelper_actionViewDiv', document)

  // Wire up the action view
  $('#spiHelper_backLink', $actionView).one('click', () => {
    spiHelperInit()
  })
  if (spiHelperActionsSelected.Case_act) {
    const result = spiHelperCaseStatusRegex.exec(pagetext)
    let casestatus = ''
    if (result) {
      casestatus = result[1]
    }
    const canAddCURequest = (casestatus === '' || /^(?:admin|moreinfo|cumoreinfo|hold|cuhold|clerk|open)$/i.test(casestatus))
    const cuRequested = /^(?:CU|checkuser|CUrequest|request|cumoreinfo)$/i.test(casestatus)
    const cuEndorsed = /^(?:endorse(d)?)$/i.test(casestatus)
    const cuCompleted = /^(?:inprogress|checking|relist(ed)?|checked|completed|declined?|cudeclin(ed)?)$/i.test(casestatus)

    /** @type {SelectOption[]} Generated array of values for the case status select box */
    const selectOpts = [
      { label: wgULS('?????????', '?????????'), value: 'noaction', selected: true }
    ]
    if (spiHelperCaseClosedRegex.test(casestatus)) {
      selectOpts.push({ label: wgULS('??????', '??????'), value: 'reopen', selected: false })
    } else if (spiHelperIsClerk() && casestatus === 'clerk') {
      // Allow clerks to change the status from clerk to open.
      // Used when clerk assistance has been given and the case previously had the status 'open'.
      selectOpts.push({ label: wgULS('?????????', '?????????'), value: 'open', selected: false })
    } else if (spiHelperIsAdmin() && casestatus === 'admin') {
      // Allow admins to change the status to open from admin
      // Used when admin assistance has been given to the non-admin clerk and the case previously had the status 'open'.
      selectOpts.push({ label: wgULS('?????????', '?????????'), value: 'open', selected: false })
    }
    if (spiHelperIsCheckuser()) {
      selectOpts.push({ label: wgULS('?????????', '?????????'), value: 'inprogress', selected: false })
    }
    if (spiHelperIsClerk() || spiHelperIsAdmin()) {
      selectOpts.push({ label: wgULS('??????????????????', '??????????????????'), value: 'moreinfo', selected: false })
    }
    if (canAddCURequest) {
      // Statuses only available if the case could be moved to "CU requested"
      selectOpts.push({ label: wgULS('????????????', '????????????'), value: 'CUrequest', selected: false })
      if (spiHelperIsClerk()) {
        selectOpts.push({ label: wgULS('???????????????????????????', '???????????????????????????'), value: 'selfendorse', selected: false })
      }
    }
    // CU already requested
    if (cuRequested) {
      selectOpts.push({ label: wgULS('????????????????????????', '????????????????????????'), value: 'condefer', selected: false })
    }
    if (cuRequested && spiHelperIsClerk()) {
      // Statuses only available if CU has been requested, only clerks + CUs should use these
      selectOpts.push({ label: '????????????', value: 'endorse', selected: false })
      // Switch the decline option depending on whether the user is a checkuser
      if (spiHelperIsCheckuser()) {
        selectOpts.push({ label: wgULS('?????????????????????', '?????????????????????'), value: 'cuendorse', selected: false })
      }
      if (spiHelperIsCheckuser()) {
        selectOpts.push({ label: wgULS('?????????????????????', '?????????????????????'), value: 'cudecline', selected: false })
      }
      selectOpts.push({ label: wgULS('????????????', '????????????'), value: 'decline', selected: false })
      selectOpts.push({ label: wgULS('???????????????????????????????????????', '???????????????????????????????????????'), value: 'cumoreinfo', selected: false })
    } else if (cuEndorsed && spiHelperIsCheckuser()) {
      // Let checkusers decline endorsed cases
      if (spiHelperIsCheckuser()) {
        selectOpts.push({ label: wgULS('?????????????????????', '?????????????????????'), value: 'cudecline', selected: false })
      }
      selectOpts.push({ label: wgULS('????????????????????????????????????????????????', '????????????????????????????????????????????????'), value: 'cumoreinfo', selected: false })
    }
    // This is mostly a CU function, but let's let clerks and admins set it
    //  in case the CU forgot (or in case we're un-closing))
    if (spiHelperIsAdmin() || spiHelperIsClerk()) {
      selectOpts.push({ label: '????????????', value: 'checked', selected: false })
    }
    if (spiHelperIsClerk() && cuCompleted) {
      selectOpts.push({ label: '??????????????????', value: 'relist', selected: false })
    }
    if (spiHelperIsCheckuser()) {
      selectOpts.push({ label: wgULS('???????????????', '???????????????'), value: 'cuhold', selected: false })
    }
    // I guess it's okay for anyone to have this option
    selectOpts.push({ label: wgULS('??????', '??????'), value: 'hold', selected: false })
    selectOpts.push({ label: wgULS('??????????????????', '??????????????????'), value: 'clerk', selected: false })
    // I think this is only useful for non-admin clerks to ask admins to do stuff
    if (!spiHelperIsAdmin() && spiHelperIsClerk()) {
      selectOpts.push({ label: wgULS('?????????????????????', '?????????????????????'), value: 'admin', selected: false })
    }
    // Generate the case action options
    spiHelperGenerateSelect('spiHelper_CaseAction', selectOpts)
    // Add the onclick handler to the drop-down
    $('#spiHelper_CaseAction', $actionView).on('change', function (e) {
      spiHelperCaseActionUpdated($(e.target))
    })
  } else {
    $('#spiHelper_actionView', $actionView).hide()
  }

  if (spiHelperActionsSelected.SpiMgmt) {
    const $xwikiBox = $('#spiHelper_spiMgmt_crosswiki', $actionView)
    const $denyBox = $('#spiHelper_spiMgmt_deny', $actionView)
    const $notalkBox = $('#spiHelper_spiMgmt_notalk', $actionView)
    const $ltaBox = $('#spiHelper_spiMgmt_lta', $actionView)

    $xwikiBox.prop('checked', spiHelperArchiveNoticeParams.xwiki)
    $denyBox.prop('checked', spiHelperArchiveNoticeParams.deny)
    $notalkBox.prop('checked', spiHelperArchiveNoticeParams.notalk)
    $ltaBox.val(spiHelperArchiveNoticeParams.lta)
  } else {
    $('#spiHelper_spiMgmtView', $actionView).hide()
  }

  if (!spiHelperActionsSelected.Close) {
    $('#spiHelper_closeView', $actionView).hide()
  }
  if (!spiHelperActionsSelected.Archive) {
    $('#spiHelper_archiveView', $actionView).hide()
  }
  // Only give the option to comment if we selected a specific section and we are not running on an archive subpage
  if (spiHelperSectionId && !spiHelperIsThisPageAnArchive) {
    // generate the note prefixes
    /** @type {SelectOption[]} */
    const spiHelperNoteTemplates = [
      { label: '????????????', selected: true, value: '', disabled: true }
    ]
    if (spiHelperIsClerk()) {
      spiHelperNoteTemplates.push({ label: wgULS('????????????', '????????????'), selected: false, value: 'clerknote' })
    }
    if (spiHelperIsAdmin()) {
      spiHelperNoteTemplates.push({ label: wgULS('???????????????', '???????????????'), selected: false, value: 'adminnote' })
    }
    if (spiHelperIsCheckuser()) {
      // spiHelperNoteTemplates.push({ label: wgULS('???????????????', '???????????????'), selected: false, value: 'cunote' })
    }
    spiHelperNoteTemplates.push({ label: wgULS('??????', '??????'), selected: false, value: 'takenote' })

    // Wire up the select boxes
    spiHelperGenerateSelect('spiHelper_noteSelect', spiHelperNoteTemplates)
    $('#spiHelper_noteSelect', $actionView).on('change', function (e) {
      spiHelperInsertNote($(e.target))
    })
    spiHelperGenerateSelect('spiHelper_adminSelect', spiHelperAdminTemplates)
    $('#spiHelper_adminSelect', $actionView).on('change', function (e) {
      spiHelperInsertTextFromSelect($(e.target))
    })
    spiHelperGenerateSelect('spiHelper_cuSelect', spiHelperCUTemplates)
    $('#spiHelper_cuSelect', $actionView).on('change', function (e) {
      spiHelperInsertTextFromSelect($(e.target))
    })
    $('#spiHelper_previewLink', $actionView).on('click', function () {
      spiHelperPreviewText()
    })
  } else {
    $('#spiHelper_commentView', $actionView).hide()
  }
  if (spiHelperActionsSelected.Rename) {
    if (spiHelperSectionId) {
      $('#spiHelper_moveHeader', $actionView).text(wgULS('???????????????', '???????????????') + spiHelperSectionName + wgULS('???', '???'))
    } else {
      $('#spiHelper_moveHeader', $actionView).text(wgULS('??????????????????', '??????????????????'))
    }
  } else {
    $('#spiHelper_moveView', $actionView).hide()
  }
  if (spiHelperActionsSelected.Block || spiHelperActionsSelected.Link) {
    // eslint-disable-next-line no-useless-escape
    const checkuserRegex = /{{\s*(?:checkuser|checkip|CUresult)\s*\|\s*(?:1=)?\s*([^\|}]*?)\s*(?:\|master name\s*=\s*.*)?}}/gi
    const results = pagetext.match(checkuserRegex)
    const likelyusers = []
    const likelyips = []
    const possibleusers = []
    const possibleips = []
    if (results) {
      for (let i = 0; i < results.length; i++) {
        const username = spiHelperNormalizeUsername(results[i].replace(checkuserRegex, '$1'))
        const isIP = mw.util.isIPAddress(username, true)
        if (!isIP && !likelyusers.includes(username)) {
          likelyusers.push(username)
        } else if (isIP && !likelyips.includes(username)) {
          likelyips.push(username)
        }
      }
    }
    const unnamedParameterRegex = /^\s*\d+\s*$/i
    const socklistResults = pagetext.match(/{{\s*sock\s?list\s*([^}]*)}}/gi)
    if (socklistResults) {
      for (let i = 0; i < socklistResults.length; i++) {
        const socklistMatch = socklistResults[i].match(/{{\s*sock\s?list\s*([^}]*)}}/i)[1]
        // First split the text into parts based on the presence of a |
        const socklistArguments = socklistMatch.split('|')
        for (let j = 0; j < socklistArguments.length; j++) {
          // Now try to split based on "=", if wasn't able to it means it's an unnamed argument
          const splitArgument = socklistArguments[j].split('=')
          let username = ''
          if (splitArgument.length === 1) {
            username = spiHelperNormalizeUsername(splitArgument[0])
          } else if (unnamedParameterRegex.test(splitArgument[0])) {
            username = spiHelperNormalizeUsername(splitArgument.slice(1).join('='))
          }
          if (username !== '') {
            const isIP = mw.util.isIPAddress(username, true)
            if (isIP && !likelyips.includes(username)) {
              likelyips.push(username)
            } else if (!isIP && !likelyusers.includes(username)) {
              likelyusers.push(username)
            }
          }
        }
      }
    }
    // eslint-disable-next-line no-useless-escape
    const userRegex = /{{\s*(?:user|vandal|IP|noping|noping2)[^\|}{]*?\s*\|\s*(?:1=)?\s*([^\|}]*?)\s*}}/gi
    const userresults = pagetext.match(userRegex)
    if (userresults) {
      for (let i = 0; i < userresults.length; i++) {
        const username = spiHelperNormalizeUsername(userresults[i].replace(userRegex, '$1'))
        const isIP = mw.util.isIPAddress(username, true)
        if (isIP && !possibleips.includes(username) &&
          !likelyips.includes(username)) {
          possibleips.push(username)
        } else if (!isIP && !possibleusers.includes(username) &&
          !likelyusers.includes(username)) {
          possibleusers.push(username)
        }
      }
    }
    if (spiHelperActionsSelected.Block) {
      if (spiHelperIsAdmin()) {
        $('#spiHelper_blockTagHeader', $actionView).text(wgULS('?????????????????????', '?????????????????????'))
      } else {
        $('#spiHelper_blockTagHeader', $actionView).text(wgULS('????????????', '????????????'))
      }
      // Wire up the "select all" options
      $('#spiHelper_block_doblock', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_acb', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_ab', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_tp', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_email', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_lock', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_lock', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      spiHelperGenerateSelect('spiHelper_block_tag', spiHelperTagOptions)
      $('#spiHelper_block_tag', $actionView).on('change', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      // spiHelperGenerateSelect('spiHelper_block_tag_altmaster', spiHelperAltMasterTagOptions)
      // $('#spiHelper_block_tag_altmaster', $actionView).on('change', function (e) {
      //   spiHelperSetAllTableColumnOpts($(e.target), 'block')
      // })
      $('#spiHelper_block_lock', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })

      for (let i = 0; i < likelyusers.length; i++) {
        spiHelperBlockTableUserCount++
        await spiHelperGenerateBlockTableLine(likelyusers[i], true, spiHelperBlockTableUserCount)
      }
      for (let i = 0; i < likelyips.length; i++) {
        spiHelperBlockTableUserCount++
        await spiHelperGenerateBlockTableLine(likelyips[i], true, spiHelperBlockTableUserCount)
      }
      for (let i = 0; i < possibleusers.length; i++) {
        spiHelperBlockTableUserCount++
        await spiHelperGenerateBlockTableLine(possibleusers[i], false, spiHelperBlockTableUserCount)
      }
      for (let i = 0; i < possibleips.length; i++) {
        spiHelperBlockTableUserCount++
        await spiHelperGenerateBlockTableLine(possibleips[i], false, spiHelperBlockTableUserCount)
      }
    } else {
      $('#spiHelper_blockTagView', $actionView).hide()
    }
    if (spiHelperActionsSelected.Link) {
      // Wire up the "select all" options
      $('#spiHelper_link_editorInteractionAnalyser', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_interactionTimeline', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_timecardSPITools', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_consolidatedTimelineSPITools', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_pagesSPITools', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_checkUserWikiSearch', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })

      for (let i = 0; i < likelyusers.length; i++) {
        spiHelperLinkTableUserCount++
        await spiHelperGenerateLinksTableLine(likelyusers[i], spiHelperLinkTableUserCount)
      }
      for (let i = 0; i < likelyips.length; i++) {
        spiHelperLinkTableUserCount++
        await spiHelperGenerateLinksTableLine(likelyips[i], spiHelperLinkTableUserCount)
      }
      for (let i = 0; i < possibleusers.length; i++) {
        spiHelperLinkTableUserCount++
        await spiHelperGenerateLinksTableLine(possibleusers[i], spiHelperLinkTableUserCount)
      }
      for (let i = 0; i < possibleips.length; i++) {
        spiHelperLinkTableUserCount++
        await spiHelperGenerateLinksTableLine(possibleips[i], spiHelperLinkTableUserCount)
      }
    } else {
      $('#spiHelper_sockLinksView', $actionView).hide()
    }
  } else {
    $('#spiHelper_blockTagView', $actionView).hide()
    $('#spiHelper_sockLinksView', $actionView).hide()
  }
  // Wire up the submit button
  $('#spiHelper_performActions', $actionView).one('click', () => {
    spiHelperPerformActions()
  })

  updateForRole($actionView)
}

/**
 * Update the view for the roles of the person running the script
 * by selectively hiding.
 * view: @type JQuery object representing the class / id for the view
 */
async function updateForRole (view) {
  // Hide items based on role
  if (!spiHelperIsCheckuser()) {
    // Hide CU options from non-CUs
    $('.spiHelper_cuClass', view).hide()
  }
  if (!spiHelperIsAdmin()) {
    // Hide block options from non-admins
    $('.spiHelper_adminClass', view).hide()
  }
  if (!(spiHelperIsAdmin() || spiHelperIsClerk())) {
    $('.spiHelper_adminClerkClass', view).hide()
  }
}

/**
 * Archives everything on the page that's eligible for archiving
 */
async function spiHelperOneClickArchive () {
  'use strict'
  spiHelperActiveOperations.set('oneClickArchive', 'running')

  const pagetext = await spiHelperGetPageText(spiHelperPageName, false)
  spiHelperCaseSections = await spiHelperGetInvestigationSectionIDs()
  if (!spiHelperSectionRegex.test(pagetext)) {
    alert(wgULS('???????????????????????????????????????', '???????????????????????????????????????'))
    spiHelperActiveOperations.set('oneClickArchive', 'successful')
    return
  }
  displayMessage('<ul id="spiHelper_status"/>')
  await spiHelperArchiveCase()
  await spiHelperPurgePage(spiHelperPageName)
  const logMessage = '* [[' + spiHelperPageName + ']]???' + wgULS('?????????????????????', '?????????????????????') + '???~~~~~'
  if (spiHelperSettings.log) {
    spiHelperLog(logMessage)
  }
  $('#spiHelper_status', document).append($('<li>').text('?????????'))
  spiHelperActiveOperations.set('oneClickArchive', 'successful')
}

/**
 * Another "meaty" function - goes through the action selections and executes them
 */
async function spiHelperPerformActions () {
  'use strict'
  spiHelperActiveOperations.set('mainActions', 'running')

  // Again, reduce the search scope
  const $actionView = $('#spiHelper_actionViewDiv', document)

  // set up a few function-scoped vars
  let comment = ''
  let blockSummaryNoLink = false
  let cuBlock = false
  let cuBlockOnly = false
  let newCaseStatus = 'noaction'
  let renameTarget = ''
  let renameAddOldName = false

  /** @type {boolean} */
  const blankTalk = $('#spiHelper_blanktalk', $actionView).prop('checked')
  /** @type {boolean} */
  const overrideExisting = $('#spiHelper_override', $actionView).prop('checked')
  /** @type {boolean} */
  const hideLockNames = $('#spiHelper_hidelocknames', $actionView).prop('checked')

  if (spiHelperActionsSelected.Case_act) {
    newCaseStatus = $('#spiHelper_CaseAction', $actionView).val().toString()
  }
  if (spiHelperActionsSelected.SpiMgmt) {
    spiHelperArchiveNoticeParams.deny = $('#spiHelper_spiMgmt_deny', $actionView).prop('checked')
    spiHelperArchiveNoticeParams.xwiki = $('#spiHelper_spiMgmt_crosswiki', $actionView).prop('checked')
    spiHelperArchiveNoticeParams.notalk = $('#spiHelper_spiMgmt_notalk', $actionView).prop('checked')
    spiHelperArchiveNoticeParams.lta = $('#spiHelper_spiMgmt_lta', $actionView).val().toString().trim()
  }
  if (spiHelperSectionId && !spiHelperIsThisPageAnArchive) {
    comment = $('#spiHelper_CommentText', $actionView).val().toString().trim()
  }
  if (spiHelperActionsSelected.Block) {
    if (spiHelperIsCheckuser()) {
      cuBlock = $('#spiHelper_cublock', $actionView).prop('checked')
      cuBlockOnly = $('#spiHelper_cublockonly', $actionView).prop('checked')
    }
    blockSummaryNoLink = $('#spiHelper_blockSummaryNoLink', $actionView).prop('checked')
    if (spiHelperIsAdmin() && !$('#spiHelper_noblock', $actionView).prop('checked')) {
      const masterNotice = $('#spiHelper_blocknoticemaster', $actionView).prop('checked')
      const sockNotice = $('#spiHelper_blocknoticesocks', $actionView).prop('checked')
      for (let i = 1; i <= spiHelperBlockTableUserCount; i++) {
        if ($('#spiHelper_block_doblock' + i, $actionView).prop('checked')) {
          if (!$('#spiHelper_block_username' + i, $actionView).val().toString()) {
            // Skip blank usernames, empty string is falsey
            continue
          }
          let noticetype = ''

          const username = spiHelperNormalizeUsername($('#spiHelper_block_username' + i, $actionView).val().toString())

          if (masterNotice && ($('#spiHelper_block_tag' + i, $actionView).val().toString().includes('master') ||
                spiHelperNormalizeUsername(spiHelperCaseName) === username)) {
            noticetype = 'master'
          } else if (sockNotice) {
            noticetype = 'sock'
          }

          /** @type {BlockEntry} */
          const item = {
            username: username,
            duration: $('#spiHelper_block_duration' + i, $actionView).val().toString(),
            acb: $('#spiHelper_block_acb' + i, $actionView).prop('checked'),
            ab: $('#spiHelper_block_ab' + i, $actionView).prop('checked'),
            ntp: $('#spiHelper_block_tp' + i, $actionView).prop('checked'),
            nem: $('#spiHelper_block_email' + i, $actionView).prop('checked'),
            tpn: noticetype
          }
          spiHelperBlocks.push(item)
        }
        if ($('#spiHelper_block_lock' + i, $actionView).prop('checked')) {
          spiHelperGlobalLocks.push($('#spiHelper_block_username' + i, $actionView).val().toString())
        }
        if ($('#spiHelper_block_tag' + i).val() !== '') {
          if (!$('#spiHelper_block_username' + i, $actionView).val().toString()) {
            // Skip blank entries
            continue
          }
          const item = {
            username: spiHelperNormalizeUsername($('#spiHelper_block_username' + i, $actionView).val().toString()),
            tag: $('#spiHelper_block_tag' + i, $actionView).val().toString(),
            altmasterTag: '', // $('#spiHelper_block_tag_altmaster' + i, $actionView).val().toString(),
            blocking: $('#spiHelper_block_doblock' + i, $actionView).prop('checked')
          }
          spiHelperTags.push(item)
        }
      }
    } else {
      for (let i = 1; i <= spiHelperBlockTableUserCount; i++) {
        if (!$('#spiHelper_block_username' + i, $actionView).val().toString()) {
          // Skip blank entries
          continue
        }
        if ($('#spiHelper_block_tag' + i, $actionView).val() !== '') {
          const item = {
            username: spiHelperNormalizeUsername($('#spiHelper_block_username' + i, $actionView).val().toString()),
            tag: $('#spiHelper_block_tag' + i, $actionView).val().toString(),
            altmasterTag: '', // $('#spiHelper_block_tag_altmaster' + i, $actionView).val().toString(),
            blocking: false
          }
          spiHelperTags.push(item)
        }
        if ($('#spiHelper_block_lock' + i, $actionView).prop('checked')) {
          spiHelperGlobalLocks.push(spiHelperNormalizeUsername($('#spiHelper_block_username' + i, $actionView).val().toString()))
        }
      }
    }
  }
  if (spiHelperActionsSelected.Close) {
    spiHelperActionsSelected.Close = $('#spiHelper_CloseCase', $actionView).prop('checked')
  }
  if (spiHelperActionsSelected.Rename) {
    renameTarget = spiHelperNormalizeUsername($('#spiHelper_moveTarget', $actionView).val().toString())
    renameAddOldName = $('#spiHelper_AddOldName', $actionView).prop('checked')
  }
  if (spiHelperActionsSelected.Archive) {
    spiHelperActionsSelected.Archive = $('#spiHelper_ArchiveCase', $actionView).prop('checked')
  }

  displayMessage('<div id="linkViewResults" hidden><h4>' + wgULS('???????????????', '???????????????') + '</h4><ul id="linkViewResultsList"></ul></div><h4>' + wgULS('?????????????????????', '?????????????????????') + '</h4><ul id="spiHelper_status" />')

  const $statusAnchor = $('#spiHelper_status', document)

  let sectionText = await spiHelperGetPageText(spiHelperPageName, true, spiHelperSectionId)
  let editsummary = ''
  let logMessage = '* [[' + spiHelperPageName + ']]'
  if (spiHelperSectionId) {
    logMessage += wgULS('?????????', '?????????') + spiHelperSectionName + '???'
  } else {
    logMessage += wgULS('??????????????????', '??????????????????')
  }
  logMessage += '~~~~~'

  if (spiHelperActionsSelected.Link) {
    $('#linkViewResults', document).show()
    const spiHelperUsersForLinks = {
      editorInteractionAnalyser: [],
      interactionTimeline: [],
      timecardSPITools: [],
      consolidatedTimelineSPITools: [],
      pagesSPITools: [],
      checkUserWikiSearch: []
    }
    for (let i = 1; i <= spiHelperLinkTableUserCount; i++) {
      const username = $('#spiHelper_link_username' + i, $actionView).val().toString()
      if (!username) {
        // Skip blank usernames
        continue
      }
      if ($('#spiHelper_link_editorInteractionAnalyser' + i, $actionView).prop('checked')) spiHelperUsersForLinks.editorInteractionAnalyser.push(username)
      if ($('#spiHelper_link_interactionTimeline' + i, $actionView).prop('checked')) spiHelperUsersForLinks.interactionTimeline.push(username)
      if ($('#spiHelper_link_timecardSPITools' + i, $actionView).prop('checked')) spiHelperUsersForLinks.timecardSPITools.push(username)
      if ($('#spiHelper_link_consolidatedTimelineSPITools' + i, $actionView).prop('checked')) spiHelperUsersForLinks.consolidatedTimelineSPITools.push(username)
      if ($('#spiHelper_link_pagesSPITools' + i, $actionView).prop('checked')) spiHelperUsersForLinks.pagesSPITools.push(username)
      if ($('#spiHelper_link_checkUserWikiSearch' + i, $actionView).prop('checked')) spiHelperUsersForLinks.checkUserWikiSearch.push(username)
    }

    const $linkViewList = $('#linkViewResultsList', document)
    for (const link in spiHelperUsersForLinks) {
      if (spiHelperUsersForLinks[link].length === 0) continue
      const URLentry = spiHelperLinkViewURLFormats[link]
      let generatedURL = URLentry.baseurl + '?' + (URLentry.multipleUserQueryStringKeys ? '' : URLentry.userQueryStringKey + '=')
      for (let i = 0; i < spiHelperUsersForLinks[link].length; i++) {
        const username = spiHelperUsersForLinks[link][i]
        generatedURL += (i === 0 ? '' : URLentry.userQueryStringSeparator)
        if (URLentry.multipleUserQueryStringKeys) {
          generatedURL += URLentry.userQueryStringKey + '=' + URLentry.userQueryStringWrapper + encodeURIComponent(username) + URLentry.userQueryStringWrapper
        } else {
          generatedURL += URLentry.userQueryStringWrapper + encodeURIComponent(username) + URLentry.userQueryStringWrapper
        }
      }
      generatedURL += (URLentry.appendToQueryString === '' ? '' : '&') + URLentry.appendToQueryString
      const $statusLine = $('<li>').appendTo($linkViewList)
      const $statusLineLink = $('<a>').appendTo($statusLine)
      $statusLineLink.attr('href', generatedURL).attr('target', '_blank').attr('rel', 'noopener noreferrer').text(spiHelperLinkViewURLFormats[link].name)
    }
  }

  if (spiHelperSectionId !== null && !spiHelperIsThisPageAnArchive) {
    let caseStatusResult = spiHelperCaseStatusRegex.exec(sectionText)
    if (caseStatusResult === null) {
      sectionText = sectionText.replace(/^(\s*===.*===[^\S\r\n]*)/, '$1\n{{SPI case status|}}')
      caseStatusResult = spiHelperCaseStatusRegex.exec(sectionText)
    }
    const oldCaseStatus = caseStatusResult[1] || 'open'
    if (newCaseStatus === 'noaction') {
      newCaseStatus = oldCaseStatus
    }

    if (spiHelperActionsSelected.Case_act && newCaseStatus !== 'noaction') {
      switch (newCaseStatus) {
        case 'reopen':
          newCaseStatus = 'open'
          editsummary = wgULS('??????', '??????')
          break
        case 'open':
          editsummary = wgULS('?????????', '?????????')
          break
        case 'CUrequest':
          editsummary = wgULS('????????????', '????????????')
          break
        case 'admin':
          editsummary = wgULS('?????????????????????', '?????????????????????')
          break
        case 'clerk':
          editsummary = wgULS('??????????????????', '??????????????????')
          break
        case 'selfendorse':
          newCaseStatus = 'endorse'
          editsummary = wgULS('???????????????????????????', '???????????????????????????')
          break
        case 'checked':
          editsummary = '????????????'
          break
        case 'inprogress':
          editsummary = wgULS('?????????', '?????????')
          break
        case 'decline':
          editsummary = wgULS('????????????', '????????????')
          break
        case 'cudecline':
          editsummary = wgULS('???????????????????????????', '???????????????????????????')
          break
        case 'endorse':
          editsummary = '????????????'
          break
        case 'cuendorse':
          editsummary = wgULS('?????????????????????', '?????????????????????')
          break
        case 'moreinfo': // Intentional fallthrough
        case 'cumoreinfo':
          editsummary = wgULS('??????????????????', '??????????????????')
          break
        case 'relist':
          editsummary = '??????????????????'
          break
        case 'hold':
          editsummary = wgULS('??????', '??????')
          break
        case 'cuhold':
          editsummary = wgULS('???????????????', '???????????????')
          break
        case 'noaction':
          // Do nothing
          break
        default:
          console.error(wgULS('??????????????????????????????', '??????????????????????????????') + newCaseStatus)
      }
      logMessage += '\n** ' + wgULS('??????????????????', '??????????????????') + oldCaseStatus + wgULS('??????', '??????') + newCaseStatus
    }
  }

  if (spiHelperActionsSelected.SpiMgmt) {
    const newArchiveNotice = spiHelperMakeNewArchiveNotice(spiHelperCaseName, spiHelperArchiveNoticeParams)
    sectionText = sectionText.replace(spiHelperArchiveNoticeRegex, newArchiveNotice)
    if (editsummary) {
      editsummary += wgULS('?????????????????????', '?????????????????????')
    } else {
      editsummary = wgULS('??????????????????', '??????????????????')
    }
    logMessage += '\n** ' + wgULS('?????????????????????', '?????????????????????')
  }

  if (spiHelperActionsSelected.Block) {
    let sockmaster = ''
    let altmaster = ''
    let needsAltmaster = false
    spiHelperTags.forEach(async (tagEntry) => {
      // we do not support tagging IPs
      if (mw.util.isIPAddress(tagEntry.username, true)) {
        // Skip, this is an IP
        return
      }
      if (tagEntry.tag.includes('master')) {
        sockmaster = tagEntry.username
      }
      if (tagEntry.altmasterTag !== '') {
        needsAltmaster = true
      }
    })
    if (sockmaster === '') {
      sockmaster = prompt(wgULS('???????????????????????????', '???????????????????????????'), spiHelperCaseName) || spiHelperCaseName
    }
    if (needsAltmaster) {
      altmaster = prompt(wgULS('????????????????????????????????????', '????????????????????????????????????'), spiHelperCaseName) || spiHelperCaseName
    }

    let blockedList = ''
    if (spiHelperIsAdmin()) {
      spiHelperBlocks.forEach(async (blockEntry) => {
        const blockReason = await spiHelperGetUserBlockReason(blockEntry.username)
        if (!spiHelperIsCheckuser() && overrideExisting &&
          spiHelperCUBlockRegex.exec(blockReason)) {
          // If you're not a checkuser, we've asked to overwrite existing blocks, and the block
          // target has a CU block on them, check whether that was intended
          if (!confirm(wgULS('?????????', '????????????') + blockEntry.username + wgULS('??????????????????CU??????????????????????????????????????????', '??????????????????CU??????????????????????????????????????????') + '\n' +
            wgULS('?????????????????????', '?????????????????????') + '\n' + blockReason
          )) {
            return
          }
        }
        const isIP = mw.util.isIPAddress(blockEntry.username, true)
        const isIPRange = isIP && !mw.util.isIPAddress(blockEntry.username, false)
        let blockSummary = isIP ? wgULS('??????[[WP:SOCK|??????IP??????]]', '??????[[WP:SOCK|??????IP??????]]') : wgULS('??????[[WP:SOCK|????????????]]', '??????[[WP:SOCK|????????????]]')
        if (spiHelperIsCheckuser() && cuBlock) {
          const cublockTemplate = isIP ? ('{{checkuserblock}}') : ('{{checkuserblock-account}}')
          if (cuBlockOnly) {
            blockSummary = cublockTemplate
          } else {
            blockSummary = cublockTemplate + '???' + blockSummary
          }
        } else if (isIPRange) {
          blockSummary = '{{Range block}}'
        }
        if (!blockSummaryNoLink) {
          blockSummary += '<!-- ' + wgULS('?????????', '?????????') + '[[' + spiHelperPageName + ']] -->'
        }
        const blockSuccess = await spiHelperBlockUser(
          blockEntry.username,
          blockEntry.duration,
          blockSummary,
          overrideExisting,
          (isIP ? blockEntry.ab : false),
          blockEntry.acb,
          (isIP ? false : blockEntry.ab),
          blockEntry.ntp,
          blockEntry.nem,
          spiHelperSettings.watchBlockedUser,
          spiHelperSettings.watchBlockedUserExpiry)
        if (!blockSuccess) {
          // Don't add a block notice if we failed to block
          if (blockEntry.tpn) {
            // Also warn the user if we were going to post a block notice on their talk page
            const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
            $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + blockEntry.username + wgULS('????????????????????????????????????', '????????????????????????????????????') + '</b>')
          }
          return
        }
        if (blockedList) {
          blockedList += '???'
        }
        blockedList += '{{unping|' + blockEntry.username + '}}'

        if (isIPRange) {
          // There isn't really a talk page for an IP range, so return here before we reach that section
          return
        }
        // Talk page notice
        if (blockEntry.tpn) {
          let newText = ''
          let isSock = blockEntry.tpn.includes('sock')
          // Hacky workaround for when we didn't make a master tag
          if (isSock && blockEntry.username === spiHelperNormalizeUsername(sockmaster)) {
            isSock = false
          }
          if (isSock) {
            newText = '== ' + wgULS('??????????????????????????????', '??????????????????????????????') + ' ==\n'
          } else {
            newText = '== ' + wgULS('???????????????????????????', '???????????????????????????') + ' ==\n'
          }
          newText += '{{subst:uw-sockblock|spi=' + spiHelperCaseName
          if (blockEntry.duration === 'indefinite' || blockEntry.duration === 'infinity') {
            newText += '|indef=yes'
          } else {
            newText += '|duration=' + blockEntry.duration
          }
          if (blockEntry.ntp) {
            newText += '|notalk=yes'
          }
          newText += '|sig=yes'
          if (isSock) {
            newText += '|master=' + sockmaster
          }
          newText += '}}'

          if (!blankTalk) {
            const oldtext = await spiHelperGetPageText('User talk:' + blockEntry.username, true)
            if (oldtext !== '') {
              newText = oldtext + '\n' + newText
            }
          }
          // Hardcode the watch setting to 'nochange' since we will have either watched or not watched based on the _boolean_
          // watchBlockedUser
          spiHelperEditPage('User talk:' + blockEntry.username,
            newText, wgULS('??????', '??????') + '[[' + spiHelperPageName + ']]' + wgULS('????????????????????????', '????????????????????????'), false, 'nochange')
        }
      })
    }
    if (blockedList) {
      logMessage += '\n** ' + wgULS('?????????', '?????????') + blockedList
    }

    let tagged = ''
    if (sockmaster) {
      // Whether we should purge sock pages (needed when we create a category)
      let needsPurge = false
      // True for each we need to check if the respective category (e.g.
      // "Suspected sockpuppets of Test") exists
      let checkConfirmedCat = false
      let checkSuspectedCat = false
      let checkAltSuspectedCat = false
      let checkAltConfirmedCat = false
      spiHelperTags.forEach(async (tagEntry) => {
        if (mw.util.isIPAddress(tagEntry.username, true)) {
          return // do not support tagging IPs
        }
        const existsGlobally = spiHelperDoesUserExistGlobally(tagEntry.username)
        const existsLocally = spiHelperDoesUserExistLocally(tagEntry.username)
        if (!existsGlobally && !existsLocally) {
          // Skip, don't tag accounts that don't exist
          const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
          $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + tagEntry.username + wgULS('???????????????????????????????????????', '???????????????????????????????????????') + '</b>')
          return
        }
        if (!($('#spiHelper_tagAccountsWithoutLocalAccount', $actionView).prop('checked')) && existsGlobally && !existsLocally) {
          // Skip as the account does not exist locally but the "tag accounts that exist locally" setting is unchecked.
          return
        }
        let tagText = ''
        let altmasterName = ''
        let altmasterTag = ''
        if (altmaster !== '' && tagEntry.altmasterTag !== '') {
          altmasterName = altmaster
          altmasterTag = tagEntry.altmasterTag
          switch (altmasterTag) {
            case 'suspected':
              checkAltSuspectedCat = true
              break
            case 'proven':
              checkAltConfirmedCat = true
              break
          }
        }
        let isMaster = false
        let tag = ''
        let checked = ''
        switch (tagEntry.tag) {
          case 'blocked':
            tag = 'blocked'
            checkSuspectedCat = true
            break
          case 'proven':
            tag = 'proven'
            checkConfirmedCat = true
            break
          case 'confirmed':
            tag = 'confirmed'
            checkConfirmedCat = true
            break
          case 'master':
            tag = 'blocked'
            isMaster = true
            break
          case 'sockmasterchecked':
            tag = 'blocked'
            checked = 'yes'
            isMaster = true
            break
          case 'bannedmaster':
            tag = 'banned'
            checked = 'yes'
            isMaster = true
            break
          default:
            // Should not be reachable, but since a couple people have
            // reported blank tags, let's add a safety check
            return
        }
        const isLocked = await spiHelperIsUserGloballyLocked(tagEntry.username) ? 'yes' : 'no'
        let isNotBlocked
        // If this account is going to be blocked, force isNotBlocked to 'no' - it's possible that the
        // block hasn't gone through by the time we reach this point
        if (tagEntry.blocking) {
          isNotBlocked = 'no'
        } else if (!existsLocally) {
          // If the user account does not exist locally it cannot be blocked. This check skips the need for the API call to check if the user is blocked
          isNotBlocked = 'yes'
        } else {
          // Otherwise, query whether the user is blocked
          isNotBlocked = await spiHelperGetUserBlockReason(tagEntry.username) ? 'no' : 'yes'
        }
        if (isMaster) {
          // Not doing SPI or LTA fields for now - those auto-detect right now
          // and I'm not sure if setting them to empty would mess that up
          tagText += `{{Sockpuppeteer
| 1 = ${tag}
| checked = ${checked}
}}`
        }
        // Not if-else because we tag something as both sock and master if they're a
        // sockmaster and have a suspected altmaster
        if (!isMaster || altmasterName) {
          let sockmasterName = sockmaster
          if (altmasterName && isMaster) {
            // If we have an altmaster and we're the master, swap a few values around
            sockmasterName = altmasterName
            tag = altmasterTag
            altmasterName = ''
            altmasterTag = ''
            tagText += '\n'
          }
          tagText += `{{Sockpuppet
| 1 = ${sockmasterName}
| 2 = ${tag}
| locked = ${isLocked}
| notblocked = ${isNotBlocked}
}}`
        }
        await spiHelperEditPage('User:' + tagEntry.username, tagText, wgULS('??????', '??????') + '[[' + spiHelperPageName + ']]' + wgULS('??????????????????', '??????????????????'),
          false, spiHelperSettings.watchTaggedUser, spiHelperSettings.watchTaggedUserExpiry)
        const summary = wgULS('???????????????????????????', '?????????????????????????????????')
        await spiHelperProtectPage('User:' + tagEntry.username, spiBlockedUserpageProtection, summary)
        if (tagged) {
          tagged += '???'
        }
        tagged += '{{unping|' + tagEntry.username + '}}'
      })
      if (tagged) {
        logMessage += '\n** ' + wgULS('?????????', '?????????') + tagged
      }

      if (checkAltConfirmedCat) {
        const catname = 'Category:' + altmaster + '?????????????????????'
        const cattext = await spiHelperGetPageText(catname, false)
        // Empty text means the page doesn't exist - create it
        if (!cattext) {
          await spiHelperEditPage(catname, '{{sockpuppet category}}',
            wgULS('??????', '??????') + '[[' + spiHelperPageName + ']]' + wgULS('??????????????????', '??????????????????'),
            true, spiHelperSettings.watchNewCats, spiHelperSettings.watchNewCatsExpiry)
          needsPurge = true
        }
      }
      if (checkAltSuspectedCat) {
        const catname = 'Category:' + altmaster + '?????????????????????'
        const cattext = await spiHelperGetPageText(catname, false)
        if (!cattext) {
          await spiHelperEditPage(catname, '{{sockpuppet category}}',
            wgULS('??????', '??????') + '[[' + spiHelperPageName + ']]' + wgULS('??????????????????', '??????????????????'),
            true, spiHelperSettings.watchNewCats, spiHelperSettings.watchNewCatsExpiry)
          needsPurge = true
        }
      }
      if (checkConfirmedCat) {
        const catname = 'Category:' + sockmaster + '?????????????????????'
        const cattext = await spiHelperGetPageText(catname, false)
        if (!cattext) {
          await spiHelperEditPage(catname, '{{sockpuppet category}}',
            wgULS('??????', '??????') + '[[' + spiHelperPageName + ']]' + wgULS('??????????????????', '??????????????????'),
            true, spiHelperSettings.watchNewCats, spiHelperSettings.watchNewCatsExpiry)
          needsPurge = true
        }
      }
      if (checkSuspectedCat) {
        const catname = 'Category:' + sockmaster + '?????????????????????'
        const cattext = await spiHelperGetPageText(catname, false)
        if (!cattext) {
          await spiHelperEditPage(catname, '{{sockpuppet category}}',
            wgULS('??????', '??????') + '[[' + spiHelperPageName + ']]' + wgULS('??????????????????', '??????????????????'),
            true, spiHelperSettings.watchNewCats, spiHelperSettings.watchNewCatsExpiry)
          needsPurge = true
        }
      }
      // Purge the sock pages if we created a category (to get rid of
      // the issue where the page says "click here to create category"
      // when the category was created after the page)
      if (needsPurge) {
        spiHelperTags.forEach((tagEntry) => {
          if (mw.util.isIPAddress(tagEntry.username, true)) {
            // Skip, this is an IP
            return
          }
          if (!tagEntry.tag && !tagEntry.altmasterTag) {
            // Skip, not tagged
            return
          }
          // Not bothering with an await, no need for async behavior here
          spiHelperPurgePage('User:' + tagEntry.username)
        })
      }
    }
    if (spiHelperGlobalLocks.length > 0) {
      let locked = ''
      let templateContent = ''
      let matchCount = 0
      spiHelperGlobalLocks.forEach(async (globalLockEntry) => {
        // do not support locking IPs (those are global blocks, not
        // locks, and are handled a bit differently)
        if (mw.util.isIPAddress(globalLockEntry, true)) {
          return
        }
        templateContent += '|' + (matchCount + 1) + '=' + globalLockEntry
        if (locked) {
          locked += '???'
        }
        locked += '{{unping|1=' + globalLockEntry + '}}'
        matchCount++
      })

      if (matchCount > 0) {
        if (hideLockNames) {
          // If requested, hide locked names
          templateContent += '|hidename=1'
        }
        // Parts of this code were adapted from https://github.com/Xi-Plus/twinkle-global
        let lockTemplate = ''
        if (matchCount === 1) {
          lockTemplate = '* {{LockHide' + templateContent + '}}'
        } else {
          lockTemplate = '* {{MultiLock' + templateContent + '}}'
        }
        if (!sockmaster) {
          sockmaster = prompt(wgULS('????????????????????????????????????', '????????????????????????????????????'), spiHelperCaseName) || spiHelperCaseName
        }
        const lockComment = prompt(wgULS('???????????????????????????????????????????????????', '???????????????????????????????????????????????????'), '') || ''
        const heading = hideLockNames ? 'sockpuppet(s)' : '[[Special:CentralAuth/' + sockmaster + '|' + sockmaster + ']] sock(s)'
        let message = '=== Global lock for ' + heading + ' ==='
        message += '\n{{status}}'
        message += '\n' + lockTemplate
        message += '\nSockpuppet(s) found in zhwiki sockpuppet investigation, see [[' + spiHelperInterwikiPrefix + spiHelperPageName + ']]. ' + lockComment + ' --~~~~'

        // Write lock request to [[meta:Steward requests/Global]]
        let srgText = await spiHelperGetPageText('meta:Steward requests/Global', false)
        srgText = srgText.replace(/\n+(== See also == *\n)/, '\n\n' + message + '\n\n$1')
        spiHelperEditPage('meta:Steward requests/Global', srgText, 'global lock request for ' + heading, false, 'nochange')
        $statusAnchor.append($('<li>').text(wgULS('????????????????????????', '????????????????????????')))
      }
      if (locked) {
        logMessage += '\n** ' + wgULS('???????????????', '???????????????') + locked
      }
    }
  }
  if (spiHelperSectionId && comment && comment !== '*' && !spiHelperIsThisPageAnArchive) {
    if (!sectionText.includes('\n----')) {
      sectionText.replace('<!--- ???????????????????????????????????? -->', '')
      sectionText.replace('<!-- ???????????????????????????????????? -->', '')
      sectionText += '\n----<!-- ???????????????????????????????????? -->'
    }
    if (!/~~~~/.test(comment)) {
      comment += '--~~~~'
    }
    // Clerks and admins post in the admin section
    if (spiHelperIsClerk() || spiHelperIsAdmin()) {
      // Complicated regex to find the first regex in the admin section
      // The weird (\n|.) is because we can't use /s (dot matches newline) regex mode without ES9,
      // I don't want to go there yet
      sectionText = sectionText.replace(/\n*----(?!(\n|.)*----)/, '\n' + comment + '\n----')
    } else { // Everyone else posts in the "other users" section
      sectionText = sectionText.replace(spiHelperAdminSectionWithPrecedingNewlinesRegex,
        '\n' + comment + '\n==== ??????????????????????????????????????????????????? ====\n')
    }
    if (editsummary) {
      editsummary += '?????????'
    } else {
      editsummary = '??????'
    }
    logMessage += '\n** ??????'
  }

  if (spiHelperActionsSelected.Close) {
    newCaseStatus = 'close'
    if (editsummary) {
      editsummary += wgULS('????????????????????????', '????????????????????????')
    } else {
      editsummary = wgULS('?????????????????????', '?????????????????????')
    }
    logMessage += '\n** ' + wgULS('????????????', '????????????')
  }
  if (spiHelperSectionId !== null && !spiHelperIsThisPageAnArchive) {
    const caseStatusText = spiHelperCaseStatusRegex.exec(sectionText)[0]
    sectionText = sectionText.replace(caseStatusText, '{{SPI case status|' + newCaseStatus + '}}')
  }

  // Fallback: if we somehow managed to not make an edit summary, add a default one
  if (!editsummary) {
    editsummary = wgULS('????????????', '????????????')
  }

  // Make all of the requested edits (synchronous since we might make more changes to the page), unless the page is an archive (as there should be no edits made)
  if (!spiHelperIsThisPageAnArchive) {
    const editResult = await spiHelperEditPage(spiHelperPageName, sectionText, editsummary, false,
      spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID, spiHelperSectionId)
    if (!editResult) {
      // Page edit failed (probably an edit conflict), dump the comment if we had one
      if (comment && comment !== '*') {
        $('<li>')
          .append($('<div>').addClass('spihelper-errortext')
            .append($('<b>').text(wgULS('SPI?????????????????????????????????', 'SPI?????????????????????????????????') + comment)))
          .appendTo($('#spiHelper_status', document))
      }
    }
  }
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
  if (spiHelperActionsSelected.Archive) {
    // Archive the case
    if (spiHelperSectionId === null) {
      // Archive the whole case
      logMessage += '\n** ' + wgULS('????????????', '????????????')
      await spiHelperArchiveCase()
    } else {
      // Just archive the selected section
      logMessage += '\n** ' + wgULS('????????????', '????????????')
      await spiHelperArchiveCaseSection(spiHelperSectionId)
    }
  } else if (spiHelperActionsSelected.Rename && renameTarget) {
    if (spiHelperSectionId === null) {
      // Option 1: we selected "All cases," this is a whole-case move/merge
      logMessage += '\n** ' + wgULS('??????/???????????????', '??????/???????????????') + renameTarget
      await spiHelperMoveCase(renameTarget, renameAddOldName)
    } else {
      // Option 2: this is a single-section case move or merge
      logMessage += '\n** ' + wgULS('???????????????', '???????????????') + renameTarget
      await spiHelperMoveCaseSection(renameTarget, spiHelperSectionId, renameAddOldName)
    }
  }
  if (spiHelperSettings.log) {
    spiHelperLog(logMessage)
  }

  await spiHelperPurgePage(spiHelperPageName)
  $('#spiHelper_status', document).append($('<li>').text('?????????'))
  spiHelperActiveOperations.set('mainActions', 'successful')
}

/**
 * Logs SPI actions to userspace a la Twinkle's CSD/prod/etc. logs
 *
 * @param {string} logString String with the changes the user made
 */
async function spiHelperLog (logString) {
  const now = new Date()
  const dateString = now.toLocaleString('zh', { year: 'numeric' }) + now.toLocaleString('zh', { month: 'short' })
  const dateHeader = '==\\s*' + dateString + '\\s*=='
  const dateHeaderRe = new RegExp(dateHeader, 'i')
  const dateHeaderReWithAnyDate = /==.*?==/i

  let logPageText = await spiHelperGetPageText('User:' + mw.config.get('wgUserName') + '/spihelper_log', false)
  if (!logPageText.match(dateHeaderRe)) {
    if (spiHelperSettings.reversed_log) {
      const firstHeaderMatch = logPageText.match(dateHeaderReWithAnyDate)
      logPageText = logPageText.substring(0, firstHeaderMatch.index) + '== ' + dateString + ' ==\n' + logPageText.substring(firstHeaderMatch.index)
    } else {
      logPageText += '\n== ' + dateString + ' =='
    }
  }
  if (spiHelperSettings.reversed_log) {
    const firstHeaderMatch = logPageText.match(dateHeaderReWithAnyDate)
    logPageText = logPageText.substring(0, firstHeaderMatch.index + firstHeaderMatch[0].length) + '\n' + logString + logPageText.substring(firstHeaderMatch.index + firstHeaderMatch[0].length)
  } else {
    logPageText += '\n' + logString
  }
  await spiHelperEditPage('User:' + mw.config.get('wgUserName') + '/spihelper_log', logPageText, wgULS('??????spihelper?????????', '??????spihelper?????????'), false, 'nochange')
}

// Major helper functions
/**
 * Cleanups following a rename - update the archive notice, add an archive notice to the
 * old case name, add the original sockmaster to the sock list for reference
 *
 * @param {string} oldCasePage Title of the previous case page
 * @param {boolean} addOldName Whether to add old case name
 */
async function spiHelperPostRenameCleanup (oldCasePage, addOldName) {
  'use strict'
  const replacementArchiveNotice = '<noinclude>__TOC__</noinclude>\n' + spiHelperMakeNewArchiveNotice(spiHelperCaseName, spiHelperArchiveNoticeParams) + '\n{{SPIpriorcases}}'
  const oldCaseName = oldCasePage.replace(/Wikipedia:????????????\/??????\//g, '')

  // Update previous SPI redirects to this location
  const pagesChecked = []
  const pagesToCheck = [oldCasePage]
  let currentPageToCheck = null
  while (pagesToCheck.length !== 0) {
    currentPageToCheck = pagesToCheck.pop()
    pagesChecked.push(currentPageToCheck)
    const backlinks = await spiHelperGetSPIBacklinks(currentPageToCheck)
    for (let i = 0; i < backlinks.length; i++) {
      if ((await spiHelperParseArchiveNotice(backlinks[i].title)).username === currentPageToCheck.replace(/Wikipedia:????????????\/??????\//g, '')) {
        spiHelperEditPage(backlinks[i].title, replacementArchiveNotice, wgULS('????????????????????????', '????????????????????????'), false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)
        if (pagesChecked.indexOf(backlinks[i]).title !== -1) {
          pagesToCheck.push(backlinks[i])
        }
      }
    }
  }

  // The old case should just be the archivenotice template and point to the new case
  spiHelperEditPage(oldCasePage, replacementArchiveNotice, wgULS('????????????????????????', '????????????????????????'), false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)

  // The new case's archivenotice should be updated with the new name
  let newPageText = await spiHelperGetPageText(spiHelperPageName, true)
  newPageText = newPageText.replace(spiHelperArchiveNoticeRegex, '{{SPI archive notice|1=' + spiHelperCaseName + '$2}}')
  // We also want to add the previous master to the sock list
  // We use SOCK_SECTION_RE_WITH_NEWLINE to clean up any extraneous whitespace
  if (addOldName) {
    newPageText = newPageText.replace(spiHelperSockSectionWithNewlineRegex, '==== ???????????? ====' +
    '\n* {{checkuser|1=' + oldCaseName + '|bullet=no}}???{{clerknote}}???' + wgULS('??????????????????', '??????????????????') + '???\n')
  }
  // Also remove the new master if they're in the sock list
  // This RE is kind of ugly. The idea is that we find everything from the level 4 heading
  // ending with "sockpuppets" to the level 4 heading beginning with <big> and pull the checkuser
  // template matching the current case name out. This keeps us from accidentally replacing a
  // checkuser entry in the admin section
  const newMasterReString = '(??????\\s*====.*?)\\n^\\s*\\*\\s*{{checkuser\\|(?:1=)?' + spiHelperCaseName + '(?:\\|master name\\s*=.*?)?}}\\s*$(.*====\\s*<big>)'
  const newMasterRe = new RegExp(newMasterReString, 'sm')
  newPageText = newPageText.replace(newMasterRe, '$1\n$2')

  await spiHelperEditPage(spiHelperPageName, newPageText, wgULS('????????????????????????', '????????????????????????'), false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Cleanups following a merge - re-insert the original page text
 *
 * @param {string} oldCasePage Title of the previous case page
 * @param {string} originalText Text of the page pre-merge
 * @param {boolean} addOldName Whether to add old case name
 */
async function spiHelperPostMergeCleanup (oldCasePage, originalText, addOldName) {
  'use strict'
  const oldCaseName = oldCasePage.replace(/Wikipedia:????????????\/??????\//g, '')

  let newText = await spiHelperGetPageText(spiHelperPageName, false)
  // Remove the SPI header templates from the page
  originalText = originalText.replace(/\n*<noinclude>__TOC__.*\n/ig, '')
  originalText = originalText.replace(spiHelperArchiveNoticeRegex, '')
  originalText = originalText.replace(spiHelperPriorCasesRegex, '')
  if (addOldName) {
    originalText = originalText.replace(spiHelperSockSectionWithNewlineRegex, '==== ???????????? ====' +
    '\n* {{checkuser|1=' + oldCaseName + '|bullet=no}}???{{clerknote}}???' + wgULS('??????????????????', '??????????????????') + '???\n')
  }
  newText += '\n' + originalText

  // Write the updated case
  await spiHelperEditPage(spiHelperPageName, newText, wgULS('????????????', '????????????'), false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Archive all closed sections of a case
 */
async function spiHelperArchiveCase () {
  'use strict'
  let i = 0
  let previousRev = 0
  while (i < spiHelperCaseSections.length) {
    const sectionId = spiHelperCaseSections[i].index
    const sectionText = await spiHelperGetPageText(spiHelperPageName, false,
      sectionId)

    const currentRev = await spiHelperGetPageRev(spiHelperPageName)
    if (previousRev === currentRev && currentRev !== 0) {
      // Our previous archive hasn't gone through yet, wait a bit and retry
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })

      // Re-grab the case sections list since the page may have updated
      spiHelperCaseSections = await spiHelperGetInvestigationSectionIDs()
      continue
    }
    previousRev = await spiHelperGetPageRev(spiHelperPageName)
    i++
    const result = spiHelperCaseStatusRegex.exec(sectionText)
    if (result === null) {
      // Bail out - can't find the case status template in this section
      continue
    }
    if (spiHelperCaseClosedRegex.test(result[1])) {
      // A running concern with the SPI archives is whether they exceed the post-expand
      // include size. Calculate what percent of that size the archive will be if we
      // add the current page to it - if >1, we need to archive the archive
      const postExpandPercent =
        (await spiHelperGetPostExpandSize(spiHelperPageName, sectionId) +
        await spiHelperGetPostExpandSize(spiHelperGetArchiveName())) /
        spiHelperGetMaxPostExpandSize()
      if (postExpandPercent >= 1) {
        // We'd overflow the archive, so move it and then archive the current page
        // Find the first empty archive page
        let archiveId = 1
        while (await spiHelperGetPageText(spiHelperGetArchiveName() + '/' + archiveId, false) !== '') {
          archiveId++
        }
        const newArchiveName = spiHelperGetArchiveName() + '/' + archiveId
        await spiHelperMovePage(spiHelperGetArchiveName(), newArchiveName, wgULS('???????????????????????????post expand size limit', '???????????????????????????post expand size limit'), false)
        await spiHelperEditPage(spiHelperGetArchiveName(), '', wgULS('???????????????', '??????????????????'), false, 'nochange')
      }
      // Need an await here - if we have multiple sections archiving we don't want
      // to stomp on each other
      await spiHelperArchiveCaseSection(sectionId)
      // need to re-fetch caseSections since the section numbering probably just changed,
      // also reset our index
      i = 0
      spiHelperCaseSections = await spiHelperGetInvestigationSectionIDs()
    }
  }
}

/**
 * Archive a specific section of a case
 *
 * @param {!number} sectionId The section number to archive
 */
async function spiHelperArchiveCaseSection (sectionId) {
  'use strict'
  let sectionText = await spiHelperGetPageText(spiHelperPageName, true, sectionId)
  sectionText = sectionText.replace(spiHelperCaseStatusRegex, '')
  const newarchivetext = sectionText.substring(sectionText.search(spiHelperSectionRegex))

  // Update the archive
  let archivetext = await spiHelperGetPageText(spiHelperGetArchiveName(), true)
  if (!archivetext) {
    archivetext = '__TOC__\n{{SPI archive notice|1=' + spiHelperCaseName + '}}\n{{SPIpriorcases}}'
  } else {
    archivetext = archivetext.replace(/<br\s*\/>\s*{{SPIpriorcases}}/gi, '\n{{SPIpriorcases}}') // fmt fix whenever needed.
  }
  archivetext += '\n' + newarchivetext
  const archiveSuccess = await spiHelperEditPage(spiHelperGetArchiveName(), archivetext,
    wgULS('???', '???') + '[[' + spiHelperPageName + ']]' + wgULS('??????????????????', '??????????????????'),
    false, spiHelperSettings.watchArchive, spiHelperSettings.watchArchiveExpiry)

  if (!archiveSuccess) {
    const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
    $statusLine.addClass('spihelper-errortext').append('b').text(wgULS('??????????????????????????????????????????????????????', '??????????????????????????????????????????????????????'))
    return
  }

  // Blank the section we archived
  await spiHelperEditPage(spiHelperPageName, '', wgULS('?????????????????????', '?????????????????????') + '[[' + spiHelperGetArchiveName() + ']]',
    false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID, sectionId)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Move or merge the selected case into a different case
 *
 * @param {string} target The username portion of the case this section should be merged into
 *                        (should have been normalized before getting passed in)
 * @param {boolean} addOldName Whether to add old case name
 */
async function spiHelperMoveCase (target, addOldName) {
  // Move or merge an entire case
  // Normalize: change underscores to spaces
  // target = target
  const newPageName = spiHelperPageName.replace(spiHelperCaseName, target)
  const sourcePageText = await spiHelperGetPageText(spiHelperPageName, false)
  const targetPageText = await spiHelperGetPageText(newPageName, false)

  const oldPageName = spiHelperPageName
  if (newPageName === oldPageName) {
    $('<li>')
      .append($('<div>').addClass('spihelper-errortext')
        .append($('<b>').text(wgULS('?????????????????????????????????????????????', '?????????????????????????????????????????????'))))
      .appendTo($('#spiHelper_status', document))
    return
  }
  // Housekeeping to update all of the var names following the rename
  const oldArchiveName = spiHelperGetArchiveName()
  spiHelperCaseName = target
  spiHelperPageName = newPageName
  let archivesCopied = false
  if (targetPageText) {
    // There's already a page there, we're going to merge
    // First, check if there's an archive; if so, copy its text over
    const newArchiveName = spiHelperGetArchiveName().replace(spiHelperCaseName, target)
    let sourceArchiveText = await spiHelperGetPageText(oldArchiveName, false)
    let targetArchiveText = await spiHelperGetPageText(newArchiveName, false)
    if (sourceArchiveText && targetArchiveText) {
      $('<li>')
        .append($('<div>').text(wgULS('????????????????????????????????????????????????????????????????????????', '????????????????????????????????????????????????????????????????????????')))
        .appendTo($('#spiHelper_status', document))

      // Normalize the source archive text
      sourceArchiveText = sourceArchiveText.replace(/^\s*__TOC__\s*$\n/gm, '')
      sourceArchiveText = sourceArchiveText.replace(spiHelperArchiveNoticeRegex, '')
      sourceArchiveText = sourceArchiveText.replace(spiHelperPriorCasesRegex, '')
      // Strip leading newlines
      sourceArchiveText = sourceArchiveText.replace(/^\n*/, '')
      targetArchiveText += '\n' + sourceArchiveText
      await spiHelperEditPage(newArchiveName, targetArchiveText, wgULS('???', '???') + '[[' + oldArchiveName + ']]' + wgULS('?????????????????????????????????', '?????????????????????????????????'),
        false, spiHelperSettings.watchArchive, spiHelperSettings.watchArchiveExpiry)
      archivesCopied = true
    }

    if (archivesCopied) {
      // Create a redirect
      spiHelperEditPage(oldArchiveName, '#REDIRECT [[' + newArchiveName + ']]', wgULS('?????????????????????????????????', '????????????????????????????????????'),
        false, spiHelperSettings.watchArchive, spiHelperSettings.watchArchiveExpiry)
    }
  } else {
    await spiHelperMovePage(oldPageName, spiHelperPageName, wgULS('???????????????', '???????????????') + '[[' + spiHelperPageName + ']]', false)
  }
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
  if (targetPageText) {
    // If there was a page there before, also need to do post-merge cleanup
    await spiHelperPostRenameCleanup(oldPageName, false)
    await spiHelperPostMergeCleanup(oldPageName, sourcePageText, addOldName)
  } else {
    await spiHelperPostRenameCleanup(oldPageName, addOldName)
  }
  if (archivesCopied) {
    alert(wgULS('??????????????????????????????????????????????????????????????????', '??????????????????????????????????????????????????????????????????'))
  }
}

/**
 * Move or merge a specific section of a case into a different case
 *
 * @param {string} target The username portion of the case this section should be merged into (pre-normalized)
 * @param {!number} sectionId The section ID of this case that should be moved/merged
 */
async function spiHelperMoveCaseSection (target, sectionId, addOldName) {
  // Move or merge a particular section of a case
  'use strict'
  const newPageName = spiHelperPageName.replace(spiHelperCaseName, target)
  let targetPageText = await spiHelperGetPageText(newPageName, false)
  let sectionText = await spiHelperGetPageText(spiHelperPageName, true, sectionId)
  // SOCK_SECTION_RE_WITH_NEWLINE cleans up extraneous whitespace at the top of the section
  // Have to do this transform before concatenating with targetPageText so that the
  // "originally filed" goes in the correct section
  if (addOldName) {
    sectionText = sectionText.replace(spiHelperSockSectionWithNewlineRegex, '==== ???????????? ====' +
    '\n* {{checkuser|1=' + spiHelperCaseName + '|bullet=no}}???{{clerknote}}???' + wgULS('??????????????????', '??????????????????') + '???\n')
  }

  if (targetPageText === '') {
    // Pre-load the split target with the SPI templates if it's empty
    targetPageText = '<noinclude>__TOC__</noinclude>\n{{SPI archive notice|' + target + '}}\n{{SPIpriorcases}}'
  }
  targetPageText += '\n' + sectionText

  // Intentionally not async - doesn't matter when this edit finishes
  spiHelperEditPage(newPageName, targetPageText, wgULS('?????????????????????', '?????????????????????') + '[[' + spiHelperPageName + ']]',
    false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)
  // Blank the section we moved
  await spiHelperEditPage(spiHelperPageName, '', wgULS('?????????????????????', '?????????????????????') + '[[' + newPageName + ']]',
    false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID, sectionId)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Render a text box's contents and display it in the preview area
 *
 */
async function spiHelperPreviewText () {
  const inputText = $('#spiHelper_CommentText', document).val().toString().trim()
  const renderedText = await spiHelperRenderText(spiHelperPageName, inputText)
  // Fill the preview box with the new text
  const $previewBox = $('#spiHelper_previewBox', document)
  $previewBox.html(renderedText)
  // Unhide it if it was hidden
  $previewBox.show()
}

/**
 * Given a page title, get an API to operate on that page
 *
 * @param {string} title Title of the page we want the API for
 * @return {Object} MediaWiki Api/ForeignAPI for the target page's wiki
 */
function spiHelperGetAPI (title) {
  'use strict'
  if (title.startsWith('m:') || title.startsWith('meta:')) {
    // Test on Beta Cluster
    if (mw.config.get('wgServer').includes('beta.wmflabs.org')) {
      return new mw.ForeignApi('https://meta.wikimedia.beta.wmflabs.org/w/api.php')
    } else {
      return new mw.ForeignApi('https://meta.wikimedia.org/w/api.php')
    }
  } else {
    return new mw.Api()
  }
}

/**
 * Removes the interwiki prefix from a page title
 *
 * @param {*} title Page name including interwiki prefix
 * @return {string} Just the page name
 */
function spiHelperStripXWikiPrefix (title) {
  // TODO: This only works with single-colon names, make it more robust
  'use strict'
  if (title.startsWith('m:') || title.startsWith('meta:')) {
    return title.slice(title.indexOf(':') + 1)
  } else {
    return title
  }
}

/**
 * Get the post-expand include size of a given page
 *
 * @param {string} title Page title to check
 * @param {?number} sectionId Section to check, if null check the whole page
 *
 * @return {Promise<number>} Post-expand include size of the given page/page section
 */
async function spiHelperGetPostExpandSize (title, sectionId = null) {
  // Synchronous method to get a page's post-expand include size given its title
  const finalTitle = spiHelperStripXWikiPrefix(title)

  const request = {
    action: 'parse',
    prop: 'limitreportdata',
    page: finalTitle
  }
  if (sectionId) {
    request.section = sectionId
  }
  const api = spiHelperGetAPI(title)
  try {
    const response = await api.get(request)

    // The page might not exist, so we need to handle that smartly - only get the parse
    // if the page actually parsed
    if ('parse' in response) {
      // Iterate over all properties to find the PEIS
      for (let i = 0; i < response.parse.limitreportdata.length; i++) {
        if (response.parse.limitreportdata[i].name === 'limitreport-postexpandincludesize') {
          return response.parse.limitreportdata[i][0]
        }
      }
    } else {
      // Fallback - most likely the page doesn't exist
      return 0
    }
  } catch (error) {
    // Something's gone wrong, just return 0
    return 0
  }
}

/**
 * Get the maximum post-expand size from the wgPageParseReport (it's the same for all pages)
 *
 * @return {number} The max post-expand size in bytes
 */
function spiHelperGetMaxPostExpandSize () {
  'use strict'
  return mw.config.get('wgPageParseReport').limitreport.postexpandincludesize.limit
}

/**
 * Get the inter-wiki prefix for the current wiki
 *
 * @return {string} The inter-wiki prefix
 */
function spiHelperGetInterwikiPrefix () {
  // Mostly copied from https://github.com/Xi-Plus/twinkle-global/blob/master/morebits.js
  // Most of this should be overkill (since most of these wikis don't have checkuser support)
  /** @type {string[]} */ const temp = mw.config.get('wgServer').replace(/^(https?:)?\/\//, '').split('.')
  const wikiLang = temp[0]
  const wikiFamily = temp[1]
  switch (wikiFamily) {
    case 'wikimedia':
      switch (wikiLang) {
        case 'commons':
          return ':commons:'
        case 'meta':
          return ':meta:'
        case 'species:':
          return ':species:'
        case 'incubator':
          return ':incubator:'
        default:
          return ''
      }
    case 'mediawiki':
      return 'mw'
    case 'wikidata:':
      switch (wikiLang) {
        case 'test':
          return ':testwikidata:'
        case 'www':
          return ':d:'
        default:
          return ''
      }
    case 'wikipedia':
      switch (wikiLang) {
        case 'test':
          return ':testwiki:'
        case 'test2':
          return ':test2wiki:'
        default:
          return ':w:' + wikiLang + ':'
      }
    case 'wiktionary':
      return ':wikt:' + wikiLang + ':'
    case 'wikiquote':
      return ':q:' + wikiLang + ':'
    case 'wikibooks':
      return ':b:' + wikiLang + ':'
    case 'wikinews':
      return ':n:' + wikiLang + ':'
    case 'wikisource':
      return ':s:' + wikiLang + ':'
    case 'wikiversity':
      return ':v:' + wikiLang + ':'
    case 'wikivoyage':
      return ':voy:' + wikiLang + ':'
    default:
      return ''
  }
}

// "Building-block" functions to wrap basic API calls
/**
 * Get the text of a page. Not that complicated.
 *
 * @param {string} title Title of the page to get the contents of
 * @param {boolean} show Whether to show page fetch progress on-screen
 * @param {?number} [sectionId=null] Section to retrieve, setting this to null will retrieve the entire page
 *
 * @return {Promise<string>} The text of the page, '' if the page does not exist.
 */
async function spiHelperGetPageText (title, show, sectionId = null) {
  const $statusLine = $('<li>')
  if (show) {
    // Actually display the statusLine
    $('#spiHelper_status', document).append($statusLine)
  }
  // Build the link element (use JQuery so we get escapes and such)
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)
  $statusLine.html(wgULS('??????????????????', '??????????????????') + $link.prop('outerHTML'))

  const finalTitle = spiHelperStripXWikiPrefix(title)

  const request = {
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    indexpageids: true,
    titles: finalTitle
  }

  if (sectionId) {
    request.rvsection = sectionId
  }

  try {
    const response = await spiHelperGetAPI(title).get(request)
    const pageid = response.query.pageids[0]

    if (pageid === '-1') {
      $statusLine.html(wgULS('??????', '??????') + $link.html() + '?????????')
      return ''
    }
    $statusLine.html('?????????' + $link.html())
    return response.query.pages[pageid].revisions[0].slots.main['*']
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + $link.html() + wgULS('??????', '??????') + '</b>???' + error)
    return ''
  }
}

/**
 *
 * @param {string} title Title of the page to edit
 * @param {string} newtext New content of the page
 * @param {string} summary Edit summary to use for the edit
 * @param {boolean} createonly Only try to create the page - if false,
 *                             will fail if the page already exists
 * @param {string} watch What watchlist setting to use when editing - decides
 *                       whether the edited page will be watched
 * @param {string} watchExpiry Duration to watch the edited page, if unset
 *                             defaults to 'indefinite'
 * @param {?number} baseRevId Base revision ID, used to detect edit conflicts. If null,
 *                           we'll grab the current page ID.
 * @param {?number} [sectionId=null] Section to edit - if null, edits the whole page
 *
 * @return {Promise<boolean>} Whether the edit was successful
 */
async function spiHelperEditPage (title, newtext, summary, createonly, watch, watchExpiry = null, baseRevId = null, sectionId = null) {
  let activeOpKey = 'edit_' + title
  if (sectionId) {
    activeOpKey += '_' + sectionId
  }
  spiHelperActiveOperations.set(activeOpKey, 'running')
  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)

  $statusLine.html(wgULS('????????????', '????????????') + $link.prop('outerHTML'))

  if (!baseRevId) {
    baseRevId = await spiHelperGetPageRev(title)
  }
  const api = spiHelperGetAPI(title)
  const finalTitle = spiHelperStripXWikiPrefix(title)

  const request = {
    action: 'edit',
    watchlist: watch,
    summary: summary + spihelperAdvert,
    text: newtext,
    title: finalTitle,
    createonly: createonly,
    baserevid: baseRevId
  }
  if (sectionId) {
    request.section = sectionId
  }
  if (watchExpiry) {
    request.watchlistexpiry = watchExpiry
  }
  try {
    await api.postWithToken('csrf', request)
    $statusLine.html(wgULS('?????????', '?????????') + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
    return true
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + $link.html() + wgULS('??????', '??????') + '</b>???' + error)
    console.error(error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
    return false
  }
}
/**
 * Moves a page. Exactly what it sounds like.
 *
 * @param {string} sourcePage Title of the source page (page we're moving)
 * @param {string} destPage Title of the destination page (page we're moving to)
 * @param {string} summary Edit summary to use for the move
 * @param {boolean} ignoreWarnings Whether to ignore warnings on move (used to force-move one page over another)
 */
async function spiHelperMovePage (sourcePage, destPage, summary, ignoreWarnings) {
  // Move a page from sourcePage to destPage. Not that complicated.
  'use strict'

  const activeOpKey = 'move_' + sourcePage + '_' + destPage
  spiHelperActiveOperations.set(activeOpKey, 'running')

  // Should never be a crosswiki call
  const api = new mw.Api()

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $sourceLink = $('<a>').attr('href', mw.util.getUrl(sourcePage)).attr('title', sourcePage).text(sourcePage)
  const $destLink = $('<a>').attr('href', mw.util.getUrl(destPage)).attr('title', destPage).text(destPage)

  $statusLine.html(wgULS('????????????', '????????????') + $sourceLink.prop('outerHTML') + '???' + $destLink.prop('outerHTML'))

  try {
    await api.postWithToken('csrf', {
      action: 'move',
      from: sourcePage,
      to: destPage,
      reason: summary + spihelperAdvert,
      noredirect: false,
      movesubpages: true,
      ignoreWarnings: ignoreWarnings
    })
    $statusLine.html(wgULS('?????????', '?????????') + $sourceLink.prop('outerHTML') + '???' + $destLink.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + $sourceLink.prop('outerHTML') + '???' + $destLink.prop('outerHTML') + wgULS('??????', '??????') + '</b>???' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

/**
 * Purges a page's cache
 *
 *
 * @param {string} title Title of the page to purge
 */
async function spiHelperPurgePage (title) {
  // Forces a cache purge on the selected page
  'use strict'
  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)
  $statusLine.html('????????????' + $link.prop('outerHTML') + wgULS('?????????', '?????????'))
  const strippedTitle = spiHelperStripXWikiPrefix(title)

  const api = spiHelperGetAPI(title)
  try {
    await api.postWithToken('csrf', {
      action: 'purge',
      titles: strippedTitle
    })
    $statusLine.html('?????????' + $link.prop('outerHTML') + wgULS('?????????', '?????????'))
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>??????' + $link.prop('outerHTML') + wgULS('???????????????', '???????????????') + '</b>???' + error)
  }
}

/**
 * Blocks a user.
 *
 * @param {string} user Username to block
 * @param {string} duration Duration of the block
 * @param {string} reason Reason to log for the block
 * @param {boolean} reblock Whether to reblock - if false, nothing will happen if the target user is already blocked
 * @param {boolean} anononly For IPs, whether this is an anonymous-only block (alternative is
 *                           that logged-in users with the IP are also blocked)
 * @param {boolean} accountcreation Whether to permit the user to create new accounts
 * @param {boolean} autoblock Whether to apply an autoblock to the user's IP
 * @param {boolean} talkpage Whether to revoke talkpage access
 * @param {boolean} email Whether to block email
 * @param {boolean} watchBlockedUser Watchlist setting for whether to watch the newly-blocked user
 * @param {string} watchExpiry Duration to watch the blocked user, if unset
 *                             defaults to 'indefinite'

 * @return {Promise<boolean>} True if the block suceeded, false if not
 */
async function spiHelperBlockUser (user, duration, reason, reblock, anononly, accountcreation,
  autoblock, talkpage, email, watchBlockedUser, watchExpiry) {
  'use strict'
  const activeOpKey = 'block_' + user
  spiHelperActiveOperations.set(activeOpKey, 'running')

  if (!watchExpiry) {
    watchExpiry = 'indefinite'
  }
  const userPage = 'User:' + user
  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(userPage)).attr('title', userPage).text(user)
  $statusLine.html(wgULS('????????????', '????????????') + $link.prop('outerHTML'))

  // This is not something which should ever be cross-wiki
  const api = new mw.Api()
  try {
    await api.postWithToken('csrf', {
      action: 'block',
      expiry: duration,
      reason: reason,
      reblock: reblock,
      anononly: anononly,
      nocreate: accountcreation,
      autoblock: autoblock,
      allowusertalk: !talkpage,
      noemail: email,
      watchuser: watchBlockedUser,
      watchlistexpiry: watchExpiry,
      user: user
    })
    $statusLine.html(wgULS('?????????', '?????????') + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
    return true
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + $link.prop('outerHTML') + wgULS('??????', '??????') + '</b>???' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
    return false
  }
}

/**
 * Get whether a user is currently blocked
 *
 * @param {string} user Username
 * @return {Promise<string>} Block reason, empty string if not blocked
 */
async function spiHelperGetUserBlockReason (user) {
  'use strict'
  // This is not something which should ever be cross-wiki
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'blocks',
      bklimit: '1',
      bkusers: user,
      bkprop: 'user|reason'
    })
    if (response.query.blocks.length === 0) {
      // If the length is 0, then the user isn't blocked
      return ''
    }
    return response.query.blocks[0].reason
  } catch (error) {
    return ''
  }
}

/**
 * Get a user's current block settings
 *
 * @param {string} user Username
 * @return {Promise<BlockEntry>} Current block settings for the user, or null if the user is not blocked
*/
async function spiHelperGetUserBlockSettings (user) {
  'use strict'
  // This is not something which should ever be cross-wiki
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'blocks',
      bklimit: '1',
      bkusers: user,
      bkprop: 'user|reason|flags|expiry'
    })
    if (response.query.blocks.length === 0) {
      // If the length is 0, then the user isn't blocked
      return null
    }

    /** @type {BlockEntry} */
    const item = {
      username: user,
      duration: response.query.blocks[0].expiry,
      acb: ('nocreate' in response.query.blocks[0] || 'anononly' in response.query.blocks[0]),
      ab: 'autoblock' in response.query.blocks[0],
      ntp: !('allowusertalk' in response.query.blocks[0]),
      nem: 'noemail' in response.query.blocks[0],
      tpn: ''
    }
    return item
  } catch (error) {
    return null
  }
}

/**
 * Get whether a user is currently globally locked
 *
 * @param {string} user Username
 * @return {Promise<boolean>} Whether the user is globally locked
 */
async function spiHelperIsUserGloballyLocked (user) {
  'use strict'
  // This is not something which should ever be cross-wiki
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'globalallusers',
      agulimit: '1',
      agufrom: user,
      aguto: user,
      aguprop: 'lockinfo'
    })
    if (response.query.globalallusers.length === 0) {
      // If the length is 0, then we couldn't find the global user
      return false
    }
    // If the 'locked' field is present, then the user is locked
    return 'locked' in response.query.globalallusers[0]
  } catch (error) {
    return false
  }
}

async function spiHelperDoesUserExistLocally (user) {
  'use strict'
  // This should never be cross-wiki
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'allusers',
      agulimit: '1',
      agufrom: user,
      aguto: user
    })
    if (response.query.allusers.length === 0) {
      // If the length is 0, then we couldn't find the local account so return false
      return false
    }
    // Otherwise a local account exists so return true
    return true
  } catch (error) {
    return false
  }
}

async function spiHelperDoesUserExistGlobally (user) {
  'use strict'
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'globalallusers',
      agulimit: '1',
      agufrom: user,
      aguto: user
    })
    if (response.query.globalallusers.length === 0) {
      // If the length is 0, then we couldn't find the global user so return false
      return false
    }
    // Otherwise the global account exists so return true
    return true
  } catch (error) {
    return false
  }
}

/**
 * Get a page's latest revision ID - useful for preventing edit conflicts
 *
 * @param {string} title Title of the page
 * @return {Promise<number>} Latest revision of a page, 0 if it doesn't exist
 */
async function spiHelperGetPageRev (title) {
  'use strict'

  const finalTitle = spiHelperStripXWikiPrefix(title)
  const request = {
    action: 'query',
    prop: 'revisions',
    rvslots: 'main',
    indexpageids: true,
    titles: finalTitle
  }

  try {
    const response = await spiHelperGetAPI(title).get(request)
    const pageid = response.query.pageids[0]
    if (pageid === '-1') {
      return 0
    }
    return response.query.pages[pageid].revisions[0].revid
  } catch (error) {
    return 0
  }
}

/**
 * Delete a page. Admin-only function.
 *
 * @param {string} title Title of the page to delete
 * @param {string} reason Reason to log for the page deletion
 */
async function spiHelperDeletePage (title, reason) {
  'use strict'

  const activeOpKey = 'delete_' + title
  spiHelperActiveOperations.set(activeOpKey, 'running')

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)
  $statusLine.html(wgULS('??????', '??????') + $link.prop('outerHTML'))

  const api = spiHelperGetAPI(title)
  try {
    await api.postWithToken('csrf', {
      action: 'delete',
      title: title,
      reason: reason
    })
    $statusLine.html(wgULS('?????????', '?????????') + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + $link.prop('outerHTML') + wgULS('??????', '??????') + '</b>???' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

/**
 * Undelete a page (or, if the page exists, undelete deleted revisions). Admin-only function
 *
 * @param {string} title Title of the pgae to undelete
 * @param {string} reason Reason to log for the page undeletion
 */
async function spiHelperUndeletePage (title, reason) {
  'use strict'
  const activeOpKey = 'undelete_' + title
  spiHelperActiveOperations.set(activeOpKey, 'running')

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)
  $statusLine.html(wgULS('????????????', '????????????') + $link.prop('outerHTML'))

  const api = spiHelperGetAPI(title)
  try {
    await api.postWithToken('csrf', {
      action: 'undelete',
      title: title,
      reason: reason
    })
    $statusLine.html(wgULS('?????????', '?????????') + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + $link.prop('outerHTML') + wgULS('??????', '??????') + '</b>???' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

/**
 * Render a snippet of wikitext
 *
 * @param {string} title Page title
 * @param {string} text Text to render
 * @return {Promise<string>} Rendered version of the text
 */
async function spiHelperRenderText (title, text) {
  'use strict'

  const request = {
    action: 'parse',
    prop: 'text',
    pst: 'true',
    text: text,
    title: title
  }

  try {
    const response = await spiHelperGetAPI(title).get(request)
    return response.parse.text['*']
  } catch (error) {
    console.error(wgULS('?????????????????????', '?????????????????????') + error)
    return ''
  }
}

/**
 * Get a list of investigations on the sockpuppet investigation page
 *
 * @return {Promise<Object[]>} An array of section objects, each section is a separate investigation
 */
async function spiHelperGetInvestigationSectionIDs () {
  // Uses the parse API to get page sections, then find the investigation
  // sections (should all be level-3 headers)
  'use strict'

  // Since this only affects the local page, no need to call spiHelper_getAPI()
  const api = new mw.Api()
  const response = await api.get({
    action: 'parse',
    prop: 'sections',
    page: spiHelperPageName
  })
  const dateSections = []
  for (let i = 0; i < response.parse.sections.length; i++) {
    // TODO: also check for presence of spi case status
    if (parseInt(response.parse.sections[i].level) === 3) {
      dateSections.push(response.parse.sections[i])
    }
  }
  return dateSections
}

/**
 * Get SPI page backlinks to this SPI page.
 * Used to fix double redirects when merging cases.
 */
async function spiHelperGetSPIBacklinks (casePageName) {
  // Only looking for enwiki backlinks
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      format: 'json',
      list: 'backlinks',
      bltitle: casePageName,
      blnamespace: '4',
      bldir: 'ascending',
      blfilterredir: 'nonredirects'
    })
    return response.query.backlinks.filter((dictEntry) => {
      return dictEntry.title.startsWith('Wikipedia:????????????/??????/')
    })
  } catch (error) {
    return []
  }
}

/**
 * Get the page protection level for a SPI page.
 * Used to keep the protection level after a history merge
 */
async function spiHelperGetProtectionInformation (casePageName) {
  // Only looking for enwiki protection information
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      format: 'json',
      prop: 'info',
      titles: casePageName,
      inprop: 'protection'
    })
    return response.query.pages[Object.keys(response.query.pages)[0]].protection
  } catch (error) {
    return []
  }
}

/**
 * Gets stabilisation settings information for a page. If no pending changes exists then it returns false.
 */
async function spiHelperGetStabilisationSettings (casePageName) {
  // Only looking for enwiki stabilisation information
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      format: 'json',
      prop: 'flagged',
      titles: casePageName
    })
    const entry = response.query.pages[Object.keys(response.query.pages)[0]]
    if ('flagged' in entry) {
      return entry.flagged
    } else {
      return false
    }
  } catch (error) {
    return false
  }
}

async function spiHelperProtectPage (casePageName, protections, summary) {
  // Only lookint to protect pages on enwiki

  const activeOpKey = 'protect_' + casePageName
  spiHelperActiveOperations.set(activeOpKey, 'running')

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(casePageName)).attr('title', casePageName).text(casePageName)
  $statusLine.html(wgULS('????????????', '????????????') + $link.prop('outerHTML'))

  const api = new mw.Api()
  try {
    let protectlevelinfo = ''
    let expiryinfo = ''
    protections.forEach((dict) => {
      if (protectlevelinfo !== '') {
        protectlevelinfo = protectlevelinfo + '|'
        expiryinfo = expiryinfo + '|'
      }
      protectlevelinfo = protectlevelinfo + dict.type + '=' + dict.level
      expiryinfo = expiryinfo + dict.expiry
    })
    await api.postWithToken('csrf', {
      action: 'protect',
      format: 'json',
      title: casePageName,
      protections: protectlevelinfo,
      expiry: expiryinfo,
      reason: summary
    })
    $statusLine.html(wgULS('?????????', '?????????') + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>' + wgULS('??????', '??????') + $link.prop('outerHTML') + wgULS('??????', '??????') + '</b>???' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

async function spiHelperConfigurePendingChanges (casePageName, protectionLevel, protectionExpiry) {
  // Only lookint to protect pages on enwiki

  const activeOpKey = 'stabilize_' + casePageName
  spiHelperActiveOperations.set(activeOpKey, 'running')

  const api = new mw.Api()
  try {
    await api.postWithToken('csrf', {
      action: 'stabilize',
      format: 'json',
      titles: casePageName,
      protectlevel: protectionLevel,
      expiry: protectionExpiry,
      reason: 'Restoring pending changes protection after history merge'
    })
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

async function spiHelperGetSiteRestrictionInformation () {
  // For enwiki only as this is it's only use case
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      format: 'json',
      meta: 'siteinfo',
      siprop: 'restrictions'
    })
    return response.query.restrictions
  } catch (error) {
    return []
  }
}

/**
 * Parse given text as wikitext without it needing to be currently saved onwiki.
 *
 */
async function spiHelperParseWikitext (wikitext) {
  // For enwiki only for now
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'parse',
      prop: 'text',
      text: wikitext,
      wrapoutputclass: '',
      disablelimitreport: 1,
      disableeditsection: 1,
      contentmodel: 'wikitext'
    })
    return response.parse.text['*']
  } catch (error) {
    return ''
  }
}

/**
 * Returns true if the date provided is a valid date for strtotime in PHP (determined by using the time parser function and a parse API call)
 */
async function spiHelperValidateDate (dateInStringFormat) {
  const response = await spiHelperParseWikitext('{{#time:r|' + dateInStringFormat + '}}')
  return !response.includes('Error: Invalid time.')
}

/**
 * Pretty obvious - gets the name of the archive. This keeps us from having to regen it
 * if we rename the case
 *
 * @return {string} Name of the archive page
 */
function spiHelperGetArchiveName () {
  return spiHelperPageName + '/??????'
}

// UI helper functions
/**
 * Generate a line of the block table for a particular user
 *
 * @param {string} name Username for this block line
 * @param {boolean} defaultblock Whether to check the block box by default on this row
 * @param {number} id Index of this line in the block table
 */
async function spiHelperGenerateBlockTableLine (name, defaultblock, id) {
  'use strict'

  let currentBlock = null
  if (name) {
    currentBlock = await spiHelperGetUserBlockSettings(name)
  }

  let block, ab, acb, ntp, nem, duration

  if (currentBlock) {
    block = true
    acb = currentBlock.acb
    ab = currentBlock.ab
    ntp = currentBlock.ntp
    nem = currentBlock.nem
    duration = currentBlock.duration
  } else {
    block = defaultblock
    acb = true
    ab = true
    ntp = spiHelperArchiveNoticeParams.notalk
    nem = spiHelperArchiveNoticeParams.notalk
    duration = mw.util.isIPAddress(name, true) ? '1 week' : 'indefinite'
  }

  const $table = $('#spiHelper_blockTable', document)

  const $row = $('<tr>')
  // Username
  $('<td>').append($('<input>').attr('type', 'text').attr('id', 'spiHelper_block_username' + id)
    .val(name).addClass('.spihelper-widthlimit')).appendTo($row)
  // Block checkbox (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_doblock' + id).prop('checked', block)).appendTo($row)
  // Block duration (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'text')
    .attr('id', 'spiHelper_block_duration' + id).val(duration)
    .addClass('.spihelper-widthlimit')).appendTo($row)
  // Account creation blocked (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_acb' + id).prop('checked', acb)).appendTo($row)
  // Autoblock (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_ab' + id).prop('checked', ab)).appendTo($row)
  // Revoke talk page access (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_tp' + id).prop('checked', ntp)).appendTo($row)
  // Block email access (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_email' + id).prop('checked', nem)).appendTo($row)
  // Tag select box
  $('<td>').append($('<select>').attr('id', 'spiHelper_block_tag' + id)
    .val(name)).appendTo($row)
  // Altmaster tag select
  // $('<td>').append($('<select>').attr('id', 'spiHelper_block_tag_altmaster' + id)
  //   .val(name)).appendTo($row)
  // Global lock (disabled for IPs since they can't be locked)
  $('<td>').append($('<input>').attr('type', 'checkbox').attr('id', 'spiHelper_block_lock' + id)
    .prop('disabled', mw.util.isIPAddress(name, true))).appendTo($row)
  $table.append($row)

  // Generate the select entries
  spiHelperGenerateSelect('spiHelper_block_tag' + id, spiHelperTagOptions)
  // spiHelperGenerateSelect('spiHelper_block_tag_altmaster' + id, spiHelperAltMasterTagOptions)
}

async function spiHelperGenerateLinksTableLine (username, id) {
  'use strict'

  const $table = $('#spiHelper_userInfoTable', document)

  const $row = $('<tr>')
  // Username
  $('<td>').append($('<input>').attr('type', 'text').attr('id', 'spiHelper_link_username' + id)
    .val(username).addClass('.spihelper-widthlimit')).appendTo($row)
  // Editor interaction analyser
  $('<td>').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_editorInteractionAnalyser' + id)).attr('style', 'text-align:center;').appendTo($row)
  // Interaction timeline
  $('<td>').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_interactionTimeline' + id)).attr('style', 'text-align:center;').appendTo($row)
  // SPI tools timecard tool
  $('<td>').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_timecardSPITools' + id)).attr('style', 'text-align:center;').appendTo($row)
  // SPI tools consilidated timeline (admin only based on OAUTH requirements)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_consolidatedTimelineSPITools' + id)).attr('style', 'text-align:center;').appendTo($row)
  // SPI tools pages tool (admin only based on OAUTH requirements)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_pagesSPITools' + id)).attr('style', 'text-align:center;').appendTo($row)
  // Checkuser wiki search (CU only)
  $('<td>').addClass('spiHelper_cuClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_checkUserWikiSearch' + id)).attr('style', 'text-align:center;').appendTo($row)
  $table.append($row)
}

/**
 * Complicated function to decide what checkboxes to enable or disable
 * and which to check by default
 */
async function spiHelperSetCheckboxesBySection () {
  // Displays the top-level SPI menu
  'use strict'

  const $topView = $('#spiHelper_topViewDiv', document)
  // Get the value of the selection box
  if ($('#spiHelper_sectionSelect', $topView).val() === 'all') {
    spiHelperSectionId = null
    spiHelperSectionName = null
  } else {
    spiHelperSectionId = parseInt($('#spiHelper_sectionSelect', $topView).val().toString())
    const $sectionSelect = $('#spiHelper_sectionSelect', $topView)
    spiHelperSectionName = spiHelperCaseSections[$sectionSelect.prop('selectedIndex')].line
  }

  const $warningText = $('#spiHelper_warning', $topView)
  $warningText.hide()

  const $archiveBox = $('#spiHelper_Archive', $topView)
  const $blockBox = $('#spiHelper_BlockTag', $topView)
  const $closeBox = $('#spiHelper_Close', $topView)
  const $commentBox = $('#spiHelper_Comment', $topView)
  const $moveBox = $('#spiHelper_Move', $topView)
  const $caseActionBox = $('#spiHelper_Case_Action', $topView)
  const $spiMgmtBox = $('#spiHelper_SpiMgmt', $topView)

  // Start by unchecking everything
  $archiveBox.prop('checked', false)
  $blockBox.prop('checked', false)
  $closeBox.prop('checked', false)
  $commentBox.prop('checked', false)
  $moveBox.prop('checked', false)
  $caseActionBox.prop('checked', false)
  $spiMgmtBox.prop('checked', false)

  // Enable optionally-disabled boxes
  $closeBox.prop('disabled', false)
  $archiveBox.prop('disabled', false)

  // archivenotice sanity check
  const pageText = await spiHelperGetPageText(spiHelperPageName, false)

  const result = spiHelperArchiveNoticeRegex.exec(pageText)
  if (!result) {
    $warningText.append($('<b>').text(wgULS('??????????????????????????????', '??????????????????????????????')))
    $warningText.show()
  }

  if (spiHelperSectionId === null) {
    // Hide inputs that aren't relevant in the case view
    $('.spiHelper_singleCaseOnly', $topView).hide()
    // Show inputs only visible in all-case mode
    $('.spiHelper_allCasesOnly', $topView).show()
    // Fix the move label
    $('#spiHelper_moveLabel', $topView).text(wgULS('????????????????????????????????????', '????????????????????????????????????'))
    // enable the move box
    $moveBox.prop('disabled', false)
  } else {
    const sectionText = await spiHelperGetPageText(spiHelperPageName, false, spiHelperSectionId)
    if (!spiHelperSectionRegex.test(sectionText)) {
      // Nothing to do here.
      return
    }

    // Unhide single-case options
    $('.spiHelper_singleCaseOnly', $topView).show()
    // Hide inputs only visible in all-case mode
    $('.spiHelper_allCasesOnly', $topView).hide()

    const result = spiHelperCaseStatusRegex.exec(sectionText)
    let casestatus = ''
    if (result) {
      casestatus = result[1]
    } else if (!spiHelperIsThisPageAnArchive) {
      $warningText.append($('<b>').text(wgULS('?????????', '?????????') + spiHelperSectionName + wgULS('??????????????????', '??????????????????')))
      $warningText.show()
    }

    // Disable the section move setting if you haven't opted into it
    if (!spiHelperSettings.iUnderstandSectionMoves) {
      $moveBox.prop('disabled', true)
    }

    const isClosed = spiHelperCaseClosedRegex.test(casestatus)

    if (isClosed) {
      $closeBox.prop('disabled', true)
      if (spiHelperSettings.tickArchiveWhenCaseClosed) {
        $archiveBox.prop('checked', true)
      }
    } else {
      $archiveBox.prop('disabled', true)
      $('#spiHelper_Case_Action', $topView).on('click', function () {
        $('#spiHelper_Close', $topView).prop('disabled', $('#spiHelper_Case_Action', $topView).prop('checked'))
      })
      $('#spiHelper_Close', $topView).on('click', function () {
        $('#spiHelper_Case_Action', $topView).prop('disabled', $('#spiHelper_Close', $topView).prop('checked'))
      })
    }

    // Change the label on the rename button
    $('#spiHelper_moveLabel', $topView).html(wgULS('?????????????????????', '?????????????????????') + '<span title="' + wgULS('????????????????????????????????????', '????????????????????????????????????') +
      wgULS('???????????????????????????????????????????????????', '??????????????????????????????????????????????????????') + '"' +
      'class="rt-commentedText spihelper-hovertext"><b>' + wgULS('????????????', '????????????') + '</b></span>???')
  }
  // Only show options suitable for the archive subpage when running on the archives
  if (spiHelperIsThisPageAnArchive) {
    $('.spiHelper_notOnArchive', $topView).hide()
  }
}

/**
 * Updates whether the 'archive' checkbox is enabled
 */
function spiHelperUpdateArchive () {
  // Archive should only be an option if close is checked or disabled (disabled meaning that
  // the case is closed) and rename is not checked
  'use strict'
  $('#spiHelper_Archive', document).prop('disabled', !($('#spiHelper_Close', document).prop('checked') ||
    $('#spiHelper_Close', document).prop('disabled')) || $('#spiHelper_Move', document).prop('checked'))
  if ($('#spiHelper_Archive', document).prop('disabled')) {
    $('#spiHelper_Archive', document).prop('checked', false)
  }
}

/**
 * Updates whether the 'move' checkbox is enabled
 */
function spiHelperUpdateMove () {
  // Rename is mutually exclusive with archive
  'use strict'
  $('#spiHelper_Move', document).prop('disabled', $('#spiHelper_Archive', document).prop('checked'))
  if ($('#spiHelper_Move', document).prop('disabled')) {
    $('#spiHelper_Move', document).prop('checked', false)
  }
}

/**
 * Generate a select input, optionally with an onChange call
 *
 * @param {string} id Name of the input
 * @param {SelectOption[]} options Array of options objects
 */
function spiHelperGenerateSelect (id, options) {
  // Add the dates to the selector
  const $selector = $('#' + id, document)
  for (let i = 0; i < options.length; i++) {
    const o = options[i]
    $('<option>')
      .val(o.value)
      .prop('selected', o.selected)
      .text(o.label)
      .prop('disabled', o.disabled)
      .appendTo($selector)
  }
}

/**
 * Given an HTML element, sets that element's value on all block options
 * For example, checking the 'block all' button will check all per-user 'block' elements
 *
 * @param {JQuery<HTMLElement>} source The HTML input element that we're matching all selections to
 */
function spiHelperSetAllTableColumnOpts (source, forTable) {
  'use strict'
  for (let i = 1; i <= (forTable === 'link' ? spiHelperLinkTableUserCount : spiHelperBlockTableUserCount); i++) {
    const $target = $('#' + source.attr('id') + i)
    if (source.attr('type') === 'checkbox') {
      // Don't try to set disabled checkboxes
      if (!$target.prop('disabled')) {
        $target.prop('checked', source.prop('checked'))
      }
    } else {
      $target.val(source.val())
    }
  }
}

/**
 * Inserts text at the cursor's position
 *
 * @param {JQuery<HTMLElement>} source Select box that was changed
 * @param {number?} pos Position to insert text; if null, inserts at the cursor
 */
function spiHelperInsertTextFromSelect (source, pos = null) {
  const $textBox = $('#spiHelper_CommentText', document)
  // https://stackoverflow.com/questions/11076975/how-to-insert-text-into-the-textarea-at-the-current-cursor-position
  const selectionStart = parseInt($textBox.attr('selectionStart'))
  const selectionEnd = parseInt($textBox.attr('selectionEnd'))
  const startText = $textBox.val().toString()
  const newText = source.val().toString()
  if (pos === null && (selectionStart || selectionStart === 0)) {
    $textBox.val(startText.substring(0, selectionStart) +
      newText +
      startText.substring(selectionEnd, startText.length))
    $textBox.attr('selectionStart', selectionStart + newText.length)
    $textBox.attr('selectionEnd', selectionEnd + newText.length)
  } else if (pos !== null) {
    $textBox.val(startText.substring(0, pos) +
      source.val() +
      startText.substring(pos, startText.length))
    $textBox.attr('selectionStart', selectionStart + newText.length)
    $textBox.attr('selectionEnd', selectionEnd + newText.length)
  } else {
    $textBox.val(startText + newText)
  }

  // Force the selected element to reset its selection to 0
  source.prop('selectedIndex', 0)
}

/**
 * Inserts a {{note}} template at the start of the text box
 *
 * @param {JQuery<HTMLElement>} source Select box that was changed
 */
function spiHelperInsertNote (source) {
  'use strict'
  const $textBox = $('#spiHelper_CommentText', document)
  let newText = $textBox.val().toString().trim()
  // Match the start of the line, optionally including a '*' with or without whitespace around it,
  // optionally including a template which contains the string "note"
  newText = newText.replace(/^(\s*\*\s*)?({{[\w\s]*note[\w\s]*}}\s*????\s*)?/i, '* {{' + source.val() + '}}???')
  $textBox.val(newText)

  // Force the selected element to reset its selection to 0
  source.prop('selectedIndex', 0)
}

/**
 * Changes the case status in the comment box
 *
 * @param {JQuery<HTMLElement>} source Select box that was changed
 */
function spiHelperCaseActionUpdated (source) {
  const $textBox = $('#spiHelper_CommentText', document)
  let newText = $textBox.val().toString().trim()
  let newTemplate = ''
  switch (source.val()) {
    case 'CUrequest':
      newTemplate = '{{CURequest}}'
      break
    case 'admin':
      newTemplate = '{{awaitingadmin}}'
      break
    case 'clerk':
      newTemplate = '{{Clerk Request}}'
      break
    case 'selfendorse':
      newTemplate = '{{Requestandendorse}}'
      break
    case 'inprogress':
      newTemplate = '{{Inprogress}}'
      break
    case 'decline':
      newTemplate = '{{Clerkdecline}}'
      break
    case 'cudecline':
      newTemplate = '{{Cudecline}}'
      break
    case 'endorse':
      newTemplate = '{{Endorse}}'
      break
    case 'cuendorse':
      newTemplate = '{{cu-endorsed}}'
      break
    case 'moreinfo': // Intentional fallthrough
    case 'cumoreinfo':
      newTemplate = '{{moreinfo}}'
      break
    case 'relist':
      newTemplate = '{{relisted}}'
      break
    case 'hold':
    case 'cuhold':
      newTemplate = '{{onhold}}'
      break
  }
  if (spiHelperClerkStatusRegex.test(newText)) {
    newText = newText.replace(spiHelperClerkStatusRegex, newTemplate)
    if (!newTemplate) { // If the new template is empty, get rid of the stray '???'
      newText = newText.replace(/^(\s*\*\s*)????/, '$1')
    }
  } else if (newTemplate) {
    // Don't try to insert if the "new template" is empty
    // Also remove the leading *
    newText = '* ' + newTemplate + '???' + newText.replace(/^\s*\*\s*/, '')
  }
  $textBox.val(newText)
}

/**
 * Fires on page load, adds the SPI portlet and (if the page is categorized as "awaiting
 * archive," meaning that at least one closed template is on the page) the SPI-Archive portlet
 */
async function spiHelperAddLink () {
  'use strict'
  await spiHelperLoadSettings()
  await mw.loader.load('mediawiki.util')
  const initLink = mw.util.addPortletLink('p-cactions', '#', wgULS('????????????', '????????????'), 'ca-spiHelper')
  initLink.addEventListener('click', (e) => {
    e.preventDefault()
    return spiHelperInit()
  })
  if (mw.config.get('wgCategories').includes('???????????????????????????') && spiHelperIsClerk()) {
    const oneClickArchiveLink = mw.util.addPortletLink('p-cactions', '#', wgULS('????????????-??????', '????????????-??????'), 'ca-spiHelperArchive')
    $(oneClickArchiveLink).one('click', (e) => {
      e.preventDefault()
      return spiHelperOneClickArchive()
    })
  }
  window.addEventListener('beforeunload', (e) => {
    const $actionView = $('#spiHelper_actionViewDiv', document)
    if ($actionView.length > 0) {
      e.preventDefault()
      // for Chrome
      e.returnValue = ''
      return true
    }

    // Make sure no operations are still in flight
    let isDirty = false
    spiHelperActiveOperations.forEach((value, _0, _1) => {
      if (value === 'running') {
        isDirty = true
      }
    })
    if (isDirty) {
      e.preventDefault()
      e.returnValue = ''
      return true
    }
  })
}

/**
 * Checks for the existence of Special:MyPage/spihelper-options.js, and if it exists,
 * loads the settings from that page.
 */
async function spiHelperLoadSettings () {
  // Dynamically load a user's settings
  // Borrowed from code I wrote for [[User:Headbomb/unreliable.js]]
  try {
    await mw.loader.getScript('/w/index.php?title=Special:MyPage/spihelper-options.js&action=raw&ctype=text/javascript')
    if (typeof spiHelperCustomOpts !== 'undefined') {
      const keys = Object.keys(spiHelperCustomOpts)
      for (let index = 0; index < keys.length; index++) {
        const k = keys[index]
        const v = spiHelperCustomOpts[k]
        if (k in spiHelperValidSettings) {
          if (spiHelperValidSettings[k].indexOf(v) === -1) {
            mw.log.warn('Invalid option given in spihelper-options.js for the setting ' + k.toString())
            return
          }
        } else if (k in spiHelperSettingsNeedingValidDate) {
          if (!await spiHelperValidateDate(v)) {
            mw.log.warn('Invalid option given in spihelper-options.js for the setting ' + k.toString())
            return
          }
        }
        spiHelperSettings[k] = v
      }
    }
  } catch (error) {
    mw.log.error(wgULS('????????????spihelper-options.js???????????????', '????????????spihelper-options.js???????????????'))
    // More detailed error in the console
    console.error(wgULS('????????????spihelper-options.js??????????????????', '????????????spihelper-options.js??????????????????') + error)
  }
}

// User role helper functions
/**
 * Whether the current user has admin permissions, used to determine
 * whether to show block options
 *
 * @return {boolean} Whether the current user is an admin
 */
function spiHelperIsAdmin () {
  if (spiHelperSettings.debugForceAdminState !== null) {
    return spiHelperSettings.debugForceAdminState
  }
  return mw.config.get('wgUserGroups').includes('sysop')
}

/**
 * Whether the current user has checkuser permissions, used to determine
 * whether to show checkuser options
 *
 * @return {boolean} Whether the current user is a checkuser
 */

function spiHelperIsCheckuser () {
  if (spiHelperSettings.debugForceCheckuserState !== null) {
    return spiHelperSettings.debugForceCheckuserState
  }
  return mw.config.get('wgUserGroups').includes('checkuser') ||
    mw.config.get('wgUserGroups').includes('sysop') || // Allow sysop to perform CU block
    spiHelperSettings.clerk // Allow clerk to use CU functions when there is no local CU
}

/**
 * Whether the current user is a clerk, used to determine whether to show
 * clerk options
 *
 * @return {boolean} Whether the current user is a clerk
 */
function spiHelperIsClerk () {
  // Assumption: checkusers should see clerk options. Please don't prove this wrong.
  return spiHelperSettings.clerk || spiHelperIsCheckuser()
}

/**
 * Common username normalization function
 * @param {string} username Username to normalize
 *
 * @return {string} Normalized username
 */
function spiHelperNormalizeUsername (username) {
  // Replace underscores with spaces
  username = username.replace(/_/g, ' ')
  // Get rid of bad hidden characters
  username = username.replace(spiHelperHiddenCharNormRegex, '')
  // Remove leading and trailing spaces
  username = username.trim()
  if (mw.util.isIPAddress(username, true)) {
    // For IP addresses, capitalize them (really only applies to IPv6)
    username = username.toUpperCase()
  } else {
    // For actual usernames, make sure the first letter is capitalized
    username = username.charAt(0).toUpperCase() + username.slice(1)
  }
  return username
}

/**
 * Parse key features from an archivenotice
 * @param {string} page Page to parse
 *
 * @return {Promise<ParsedArchiveNotice>} Parsed archivenotice
 */
async function spiHelperParseArchiveNotice (page) {
  const pagetext = await spiHelperGetPageText(page, false)
  const match = spiHelperArchiveNoticeRegex.exec(pagetext)
  if (match === null) {
    console.error('Missing archive notice')
    return { username: null, deny: null, xwiki: null, notalk: null, lta: '' }
  }
  const username = match[1]
  let deny = false
  let xwiki = false
  let notalk = false
  let lta = ''
  if (match[2]) {
    for (const entry of match[2].split('|')) {
      if (!entry) {
        // split in such a way that it's just a pipe
        continue
      }
      const splitEntry = entry.split('=')
      if (splitEntry.length !== 2) {
        console.error(wgULS('??????????????????', '??????????????????') + entry + wgULS('????????????', '????????????'))
        continue
      }
      const key = splitEntry[0]
      const val = splitEntry[1]
      if (key.toLowerCase() === 'deny' && val.toLowerCase() === 'yes') {
        deny = true
      } else if (key.toLowerCase() === 'crosswiki' && val.toLowerCase() === 'yes') {
        xwiki = true
      } else if (key.toLowerCase() === 'notalk' && val.toLowerCase() === 'yes') {
        notalk = true
      } else if (key.toLowerCase() === 'lta') {
        lta = val.trim()
      }
    }
  }
  /** @type {ParsedArchiveNotice} */
  return {
    username: username,
    deny: deny,
    xwiki: xwiki,
    notalk: notalk,
    lta: lta
  }
}

/**
 * Helper function to make a new archivenotice
 * @param {string} username Username
 * @param {ParsedArchiveNotice} archiveNoticeParams Other archivenotice params
 *
 * @return {string} New archivenotice
 */
function spiHelperMakeNewArchiveNotice (username, archiveNoticeParams) {
  let notice = '{{SPI archive notice|1=' + username
  if (archiveNoticeParams.xwiki) {
    notice += '|crosswiki=yes'
  }
  if (archiveNoticeParams.deny) {
    notice += '|deny=yes'
  }
  if (archiveNoticeParams.notalk) {
    notice += '|notalk=yes'
  }
  if (archiveNoticeParams.lta) {
    notice += '|LTA=' + archiveNoticeParams.lta
  }
  notice += '}}'

  return notice
}

/**
 * Function to add a blank user line to the block table
 *
 * Would fail ESlint no-unused-vars due to only being
 * referenced in an onclick event
 *
 * @return {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
async function spiHelperAddBlankUserLine (tableName) {
  if (tableName === 'block') {
    spiHelperBlockTableUserCount++
    await spiHelperGenerateBlockTableLine('', true, spiHelperBlockTableUserCount)
  } else {
    spiHelperLinkTableUserCount++
    await spiHelperGenerateLinksTableLine('', spiHelperLinkTableUserCount)
  }
  updateForRole()
}

// </nowiki>
