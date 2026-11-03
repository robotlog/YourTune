import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    // Talks to YourTune's API Server plugin, the same API the app documents at /swagger
    readonly property string base: "http://127.0.0.1:" + Plasmoid.configuration.port
    property var song: null
    property string like: "INDIFFERENT"
    property bool shuffle: false
    property string repeat: "NONE"
    // "" when connected, otherwise why not: "off", "waiting" or "denied"
    property string problem: "off"
    property bool authorizing: false

    toolTipMainText: song ? song.title : "YourTune"
    toolTipSubText: song ? song.artist : problemText()
    Plasmoid.icon: song && !song.isPaused ? "media-playback-pause" : "media-playback-start"

    function problemText() {
        if (problem === "off")
            return i18n("Turn on the API Server plugin in YourTune")
        if (problem === "waiting")
            return i18n("Allow the widget in the YourTune window")
        if (problem === "denied")
            return i18n("YourTune denied access. Click to ask again")
        return ""
    }

    function request(method, path, body, done) {
        const xhr = new XMLHttpRequest()
        xhr.open(method, base + path)
        if (Plasmoid.configuration.token)
            xhr.setRequestHeader("Authorization", "Bearer " + Plasmoid.configuration.token)
        if (body)
            xhr.setRequestHeader("Content-Type", "application/json")
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE)
                return
            if (xhr.status === 0) {
                problem = "off"
                song = null
            } else if (xhr.status === 401) {
                Plasmoid.configuration.token = ""
                authorize()
            } else {
                problem = ""
                if (done)
                    done(xhr.status, xhr.status === 200 && xhr.responseText ? JSON.parse(xhr.responseText) : null)
            }
        }
        xhr.send(body ? JSON.stringify(body) : null)
    }

    // YourTune shows an Allow/Deny dialog the first time; the request waits for the answer
    function authorize() {
        if (authorizing)
            return
        authorizing = true
        problem = "waiting"
        const xhr = new XMLHttpRequest()
        xhr.open("POST", base + "/auth/plasma-widget")
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE)
                return
            authorizing = false
            if (xhr.status === 200) {
                Plasmoid.configuration.token = JSON.parse(xhr.responseText).accessToken
                refresh()
            } else {
                problem = xhr.status === 403 ? "denied" : "off"
            }
        }
        xhr.send()
    }

    function refresh() {
        // A 401 from any of these starts authorize(), which runs once at a time
        if (authorizing || problem === "denied")
            return
        request("GET", "/api/v1/song", null, function (status, data) { song = status === 200 ? data : null })
        request("GET", "/api/v1/like-state", null, function (status, data) { like = data && data.state ? data.state : "INDIFFERENT" })
        request("GET", "/api/v1/shuffle", null, function (status, data) { shuffle = !!(data && data.state) })
        request("GET", "/api/v1/repeat-mode", null, function (status, data) { repeat = data && data.mode ? data.mode : "NONE" })
    }

    function act(path, body) {
        request("POST", "/api/v1/" + path, body, function () { refresh() })
    }

    Timer {
        interval: root.expanded ? 1000 : 5000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.refresh()
    }

    fullRepresentation: ColumnLayout {
        Layout.preferredWidth: Kirigami.Units.gridUnit * 16
        Layout.preferredHeight: Kirigami.Units.gridUnit * 22
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents.Label {
            visible: root.problem !== ""
            Layout.fillWidth: true
            Layout.fillHeight: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.Wrap
            text: root.problemText()
            MouseArea {
                anchors.fill: parent
                enabled: root.problem === "denied"
                onClicked: { root.problem = ""; root.authorize() }
            }
        }

        Image {
            visible: root.problem === ""
            Layout.fillWidth: true
            Layout.fillHeight: true
            fillMode: Image.PreserveAspectFit
            source: root.song && root.song.imageSrc ? root.song.imageSrc : ""
        }

        PlasmaComponents.Label {
            visible: root.problem === ""
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            elide: Text.ElideRight
            font.bold: true
            text: root.song ? root.song.title : i18n("Nothing playing")
        }

        PlasmaComponents.Label {
            visible: root.problem === "" && root.song !== null
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            elide: Text.ElideRight
            opacity: 0.7
            text: root.song ? root.song.artist : ""
        }

        RowLayout {
            visible: root.problem === ""
            Layout.alignment: Qt.AlignHCenter
            PlasmaComponents.ToolButton {
                icon.name: "media-skip-backward"
                onClicked: root.act("previous")
            }
            PlasmaComponents.ToolButton {
                icon.name: root.song && !root.song.isPaused ? "media-playback-pause" : "media-playback-start"
                onClicked: root.act("toggle-play")
            }
            PlasmaComponents.ToolButton {
                icon.name: "media-skip-forward"
                onClicked: root.act("next")
            }
        }

        RowLayout {
            visible: root.problem === ""
            Layout.alignment: Qt.AlignHCenter
            PlasmaComponents.ToolButton {
                text: i18n("Like")
                checkable: true
                checked: root.like === "LIKE"
                onClicked: root.act("like")
            }
            PlasmaComponents.ToolButton {
                text: i18n("Dislike")
                checkable: true
                checked: root.like === "DISLIKE"
                onClicked: root.act("dislike")
            }
            PlasmaComponents.ToolButton {
                icon.name: "media-playlist-shuffle"
                checkable: true
                checked: root.shuffle
                PlasmaComponents.ToolTip.text: i18n("Shuffle")
                onClicked: root.act("shuffle")
            }
            PlasmaComponents.ToolButton {
                icon.name: root.repeat === "ONE" ? "media-playlist-repeat-song" : "media-playlist-repeat"
                checkable: true
                checked: root.repeat !== "NONE"
                PlasmaComponents.ToolTip.text: i18n("Repeat")
                onClicked: root.act("switch-repeat", { iteration: 1 })
            }
        }
    }
}
