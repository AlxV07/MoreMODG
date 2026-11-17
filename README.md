# MoreMODG

**Last Updated: Tue Nov 17, 2026**

**Current version: 0.1.5 alpha**

A Chrome extension adding enhancements to the Mother of Divine Grace School student family portal.


## Install

1. Clone project or download as ZIP (clicking green `<> Code` button -> "Download ZIP") and extract into a folder
2. Go to `chrome://extensions` and enable Developer mode (toggle in top right).
3. Select "Load unpacked" and select your downloaded folder
4. Go to your student home page (`families.modg.org/students/{studentId}`)
5. Click the Extensions popup menu (puzzle piece button in top right)
6. Select "MoreMODG"
7. Click "Setup"


## Current features

The popup's **Enable MoreMODG** switch turns enhancements off or back on while retaining the saved home page and syllabi. Set up the extension once to enable the switch. Toggling reloads the active portal tab; refresh any other open portal tabs to apply the setting there.

Implemented via site scraping (volatile stability):
* **Responsive home layout**: Courses and Unified Syllabus appear side by side when space permits and stack on narrow screens.
* **Unified Syllabus**: Displays syllabi items for all your classes in a unified view on your home page, with customization to view specific weeks or days at a glance
  * Select a calendar weekday to see each course's most recent nonblank assignment on or before that day, looking back at most seven calendar days. The assignment's original syllabus week and day are displayed, and its link opens that week.
  * Syllabus Day 1 starts on the class meeting weekday, read from the upcoming Teacher Support Schedule timestamp in your browser's local timezone. Later syllabus days skip weekends, so a Tuesday class's Day 5 falls on the following Monday. Courses are matched through their enrollment descriptions and syllabus titles. Without a matching dated meeting, Day 1 stays on Monday and the panel explains the fallback.
* **Combined Courses and Teacher Support Schedule**: Matching classes get an icon-only **Go to Class** button on the same line as the teacher and assessment controls. It reuses the portal's headphones icon and button styling, with a hover tooltip and accessible label. Upcoming meeting dates, times, and durations appear under the matching class in the unified syllabus. Teacher and grader details remain available through the existing dropdown, without an extra summary. Unmatched schedule entries remain visible in the original schedule section; meeting details without a matching syllabus remain with their course.
* **Syllabi "Jump to Today" button**: A button on each class's syllabus page to save you from scrolling a lot to get to the week's work. The "current" week the default MODG Learning Support schedule's start week (week 36 of the year = MODG school week 1); different families' asynchronous syllabi plans may differ from this calculated week.
* **Student Work select list**: Replaces the drop-down class selection button on the Student Work page with a single-click class selection list, now displaying all student work assignments by default.


## Contribute

Contact me at: https://alxv07.github.io/#connect
**Any bug reports, suggestions, or feedback is greatly appreciated!**
